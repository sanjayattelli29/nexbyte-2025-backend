const { google } = require('googleapis');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const { Readable } = require('stream');

module.exports = function (app, connectDB, transporter) {
    // ----------------------------------------------------
    // GOOGLE DRIVE API SETUP
    // ----------------------------------------------------
    let driveClient = null;

    try {
        if (process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY) {
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
                    private_key: process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n')
                },
                scopes: ['https://www.googleapis.com/auth/drive'],
            });
            driveClient = google.drive({ version: 'v3', auth });
            console.log("Google Drive API client initialized.");
        } else {
            console.warn("Google Drive credentials not set. Google Drive features will fail.");
        }
    } catch (e) {
        console.error("Failed to initialize Google Drive client:", e);
    }

    const MAIN_FOLDER_ID = process.env.NEXBYTE_CLASSES_DRIVE_FOLDER_ID;

    // Helper: Share folder/file
    async function shareDriveItem(fileId, emailAddress) {
        if (!driveClient) throw new Error("Drive client not initialized");
        const res = await driveClient.permissions.create({
            fileId: fileId,
            requestBody: {
                role: 'reader',
                type: 'user',
                emailAddress: emailAddress,
            },
            fields: 'id',
        });
        return res.data.id;
    }

    // Helper: Revoke access
    async function revokeDriveAccess(fileId, permissionId) {
        if (!driveClient || !permissionId) return;
        try {
            await driveClient.permissions.delete({
                fileId: fileId,
                permissionId: permissionId,
            });
        } catch (e) {
            console.error("Error revoking Drive access:", e.message);
        }
    }

    // Helper: Create folder
    async function createDriveFolder(folderName, parentFolderId) {
        if (!driveClient) throw new Error("Drive client not initialized");
        const fileMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId]
        };
        const folder = await driveClient.files.create({
            resource: fileMetadata,
            fields: 'id',
        });
        return folder.data.id;
    }


    // ----------------------------------------------------
    // LEARNER AUTHENTICATION
    // ----------------------------------------------------
    const otpStore = new Map(); // Simple in-memory store for OTPs (in production, use Redis or MongoDB)

    // Request OTP
    app.post('/api/classes/auth/login', async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, message: 'Email required' });

            const db = await connectDB();
            const user = await db.collection('classes_users').findOne({ email: email.toLowerCase() });
            
            if (!user || user.status !== 'active') {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Sorry, you are not a subscribed user. Please contact the administrator to get access.' 
                });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
            otpStore.set(email.toLowerCase(), { otp, expiresAt });

            const mailOptions = {
                from: `"NexByte Classes" <${process.env.SMTP_EMAIL}>`,
                to: email.toLowerCase(),
                subject: 'Your Login OTP - NexByte Classes',
                html: `<p>Your OTP for NexByte Classes is <strong>${otp}</strong>. It expires in 10 minutes.</p>`
            };
            
            await transporter.sendMail(mailOptions);
            res.json({ success: true, message: 'OTP sent' });
        } catch (error) {
            console.error('Classes Login error:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Verify OTP
    app.post('/api/classes/auth/verify', async (req, res) => {
        try {
            const { email, otp } = req.body;
            const record = otpStore.get(email);
            
            if (!record || record.otp !== otp || record.expiresAt < Date.now()) {
                return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
            }

            otpStore.delete(email);

            const db = await connectDB();
            let user = await db.collection('classes_users').findOne({ email });

            if (!user) {
                user = {
                    email,
                    status: 'pending', // pending, active, revoked
                    role: 'learner',
                    createdAt: new Date(),
                    drivePermissionId: null
                };
                const result = await db.collection('classes_users').insertOne(user);
                user._id = result.insertedId;
            }

            // Create a simple session token (in a real app, use JWT)
            const token = crypto.randomBytes(32).toString('hex');
            await db.collection('classes_sessions').insertOne({
                token,
                userId: user._id,
                email: user.email,
                role: user.role,
                status: user.status,
                createdAt: new Date()
            });

            res.json({ success: true, token, user });
        } catch (error) {
            console.error('Classes Verify error:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Middleware to check authentication
    const authMiddleware = async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

        try {
            const db = await connectDB();
            const session = await db.collection('classes_sessions').findOne({ token });
            if (!session) return res.status(401).json({ success: false, message: 'Invalid session' });

            const user = await db.collection('classes_users').findOne({ _id: session.userId });
            if (!user) return res.status(401).json({ success: false, message: 'User not found' });

            req.user = user;
            next();
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    };


    // ----------------------------------------------------
    // LEARNER API
    // ----------------------------------------------------

    // Get Dashboard Data
    app.get('/api/classes/dashboard', authMiddleware, async (req, res) => {
        try {
            if (req.user.status !== 'active') {
                return res.status(403).json({ success: false, message: 'Access pending or revoked' });
            }

            const db = await connectDB();
            const categories = await db.collection('classes_categories').find({ isPublished: true }).sort({ order: 1 }).toArray();
            const videos = await db.collection('classes_topics').find({ isPublished: true }).toArray();
            
            const progressDocs = await db.collection('classes_progress').find({ userId: req.user._id }).toArray();
            
            let totalDuration = 0;
            videos.forEach(v => {
                totalDuration += parseInt(v.duration || 0);
            });

            const completedVideos = progressDocs.filter(p => p.completed).length;
            const progress = videos.length > 0 ? (completedVideos / videos.length) * 100 : 0;

            res.json({
                success: true,
                data: {
                    totalVideos: videos.length,
                    totalDuration,
                    completedVideos,
                    progress: Math.round(progress),
                    categories,
                    recentProgress: progressDocs.sort((a,b) => b.lastWatchedTime - a.lastWatchedTime).slice(0, 5)
                }
            });
        } catch (error) {
            console.error('Dashboard error:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Get Categories
    app.get('/api/classes/categories', authMiddleware, async (req, res) => {
        if (req.user.status !== 'active') return res.status(403).json({ success: false, message: 'Access denied' });
        try {
            const db = await connectDB();
            const categories = await db.collection('classes_categories').find({ isPublished: true }).sort({ order: 1 }).toArray();
            res.json({ success: true, data: categories });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Get Topics for a Category
    app.get('/api/classes/categories/:id/topics', authMiddleware, async (req, res) => {
        if (req.user.status !== 'active') return res.status(403).json({ success: false, message: 'Access denied' });
        try {
            const db = await connectDB();
            const topics = await db.collection('classes_topics')
                .find({ categoryId: req.params.id, isPublished: true })
                .sort({ order: 1 })
                .toArray();
            
            const progress = await db.collection('classes_progress')
                .find({ userId: req.user._id, categoryId: req.params.id })
                .toArray();

            // Merge progress
            const topicsWithProgress = topics.map(t => {
                const prog = progress.find(p => p.topicId.toString() === t._id.toString());
                return { ...t, progress: prog || null };
            });

            res.json({ success: true, data: topicsWithProgress });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Get Single Video details
    app.get('/api/classes/videos/:id', authMiddleware, async (req, res) => {
        if (req.user.status !== 'active') return res.status(403).json({ success: false, message: 'Access denied' });
        try {
            const db = await connectDB();
            const video = await db.collection('classes_topics').findOne({ _id: new ObjectId(req.params.id) });
            if (!video || !video.isPublished) return res.status(404).json({ success: false, message: 'Video not found' });

            const comments = await db.collection('classes_comments').find({ topicId: req.params.id }).sort({ createdAt: -1 }).toArray();
            
            const categoryTopics = await db.collection('classes_topics')
                .find({ categoryId: video.categoryId, isPublished: true })
                .sort({ order: 1 })
                .toArray();

            res.json({ 
                success: true, 
                data: { 
                    video, 
                    comments, 
                    remainingTopics: categoryTopics,
                    userEmail: req.user.email 
                } 
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Embed endpoint to hide raw Drive URL from React UI
    app.get('/api/classes/videos/:id/embed', async (req, res) => {
        try {
            // We can optionally verify a token via query parameter if we want stricter security, 
            // but for simple obfuscation we just fetch the ID and redirect.
            const db = await connectDB();
            const video = await db.collection('classes_topics').findOne({ _id: new ObjectId(req.params.id) });
            if (!video || !video.isPublished || !video.driveFileId) {
                return res.status(404).send('Video not found');
            }
            // Redirect to Google Drive preview URL
            res.redirect(`https://drive.google.com/file/d/${video.driveFileId}/preview`);
        } catch (e) {
            res.status(500).send('Server error');
        }
    });

    // Update Progress
    app.post('/api/classes/progress', authMiddleware, async (req, res) => {
        if (req.user.status !== 'active') return res.status(403).json({ success: false, message: 'Access denied' });
        try {
            const { topicId, categoryId, watchedPercentage, lastPosition, completed } = req.body;
            const db = await connectDB();

            const updateData = {
                userId: req.user._id,
                topicId: new ObjectId(topicId),
                categoryId,
                watchedPercentage,
                lastPosition,
                completed: !!completed,
                lastWatchedTime: new Date()
            };

            await db.collection('classes_progress').updateOne(
                { userId: req.user._id, topicId: new ObjectId(topicId) },
                { $set: updateData },
                { upsert: true }
            );

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Add Comment
    app.post('/api/classes/comments', authMiddleware, async (req, res) => {
        if (req.user.status !== 'active') return res.status(403).json({ success: false, message: 'Access denied' });
        try {
            const { topicId, content } = req.body;
            if (!content || !content.trim()) return res.status(400).json({ success: false, message: 'Content required' });
            
            // Basic sanitization
            const cleanContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");

            const db = await connectDB();
            const comment = {
                topicId,
                userId: req.user._id,
                userEmail: req.user.email,
                content: cleanContent,
                createdAt: new Date()
            };

            const result = await db.collection('classes_comments').insertOne(comment);
            res.json({ success: true, data: { ...comment, _id: result.insertedId } });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });


    // ----------------------------------------------------
    // ADMIN API
    // ----------------------------------------------------
    
    // Get Learners
    app.get('/api/classes/admin/learners', async (req, res) => {
        try {
            const db = await connectDB();
            const learners = await db.collection('classes_users').find({ role: 'learner' }).sort({ createdAt: -1 }).toArray();
            res.json({ success: true, data: learners });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Add & Provide Access
    app.post('/api/classes/admin/learners/add-access', async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ success: false, message: 'Email required' });

            const emailLower = email.toLowerCase().trim();
            const db = await connectDB();
            let user = await db.collection('classes_users').findOne({ email: emailLower });

            if (user && user.status === 'active') {
                return res.status(400).json({ success: false, message: 'This email already has access' });
            }

            let permissionId = user?.drivePermissionId;
            if (!permissionId && MAIN_FOLDER_ID) {
                try {
                    permissionId = await shareDriveItem(MAIN_FOLDER_ID, emailLower);
                } catch (driveErr) {
                    console.error("Drive API sharing failed:", driveErr);
                    return res.status(500).json({ success: false, message: 'Failed to share on Drive. Ensure Service Account has Editor access.' });
                }
            }

            if (user) {
                await db.collection('classes_users').updateOne(
                    { _id: user._id },
                    { $set: { status: 'active', drivePermissionId: permissionId, approvedAt: new Date() } }
                );
            } else {
                await db.collection('classes_users').insertOne({
                    email: emailLower,
                    status: 'active',
                    role: 'learner',
                    createdAt: new Date(),
                    approvedAt: new Date(),
                    drivePermissionId: permissionId
                });
            }

            res.json({ success: true, message: 'Access provided successfully' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Revoke Access
    app.post('/api/classes/admin/learners/:id/revoke-access', async (req, res) => {
        try {
            const db = await connectDB();
            const user = await db.collection('classes_users').findOne({ _id: new ObjectId(req.params.id) });
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            if (user.drivePermissionId && MAIN_FOLDER_ID) {
                await revokeDriveAccess(MAIN_FOLDER_ID, user.drivePermissionId);
            }

            await db.collection('classes_users').updateOne(
                { _id: user._id },
                { $set: { status: 'revoked', drivePermissionId: null } }
            );

            res.json({ success: true, message: 'Access revoked' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Get Categories (Admin)
    app.get('/api/classes/admin/categories', async (req, res) => {
        try {
            const db = await connectDB();
            const categories = await db.collection('classes_categories').find({}).sort({ order: 1 }).toArray();
            res.json({ success: true, data: categories });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Create Category
    app.post('/api/classes/admin/categories', async (req, res) => {
        try {
            const { name, description, order, isPublished } = req.body;
            let folderId = null;

            if (MAIN_FOLDER_ID) {
                try {
                    folderId = await createDriveFolder(name, MAIN_FOLDER_ID);
                } catch (driveErr) {
                    console.error("Failed to create folder on Drive:", driveErr);
                }
            }

            const db = await connectDB();
            const category = {
                name, description, order: parseInt(order) || 0, isPublished: !!isPublished,
                driveFolderId: folderId,
                createdAt: new Date()
            };
            const result = await db.collection('classes_categories').insertOne(category);
            res.json({ success: true, data: { ...category, _id: result.insertedId } });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
    
    // Update Category
    app.put('/api/classes/admin/categories/:id', async (req, res) => {
        try {
            const { name, description, order, isPublished } = req.body;
            const db = await connectDB();
            await db.collection('classes_categories').updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { name, description, order: parseInt(order) || 0, isPublished: !!isPublished, updatedAt: new Date() } }
            );
            res.json({ success: true, message: 'Category updated' });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Delete Category
    app.delete('/api/classes/admin/categories/:id', async (req, res) => {
        try {
            const db = await connectDB();
            await db.collection('classes_categories').deleteOne({ _id: new ObjectId(req.params.id) });
            await db.collection('classes_topics').deleteMany({ categoryId: req.params.id });
            res.json({ success: true, message: 'Category deleted' });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Get Google Drive Files for Category (Admin)
    app.get('/api/classes/admin/categories/:categoryId/drive-files', async (req, res) => {
        try {
            const db = await connectDB();
            const category = await db.collection('classes_categories').findOne({ _id: new ObjectId(req.params.categoryId) });
            
            if (!category || !category.driveFolderId) {
                return res.status(404).json({ success: false, message: 'Category or Google Drive folder not found' });
            }

            if (!driveClient) throw new Error("Drive client not initialized");

            const response = await driveClient.files.list({
                q: `'${category.driveFolderId}' in parents and trashed = false`,
                fields: 'files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
                pageSize: 100
            });

            // Filter for video files only (or let frontend filter, but filtering here is better)
            const videoFiles = response.data.files.filter(file => file.mimeType.startsWith('video/'));

            res.json({ success: true, data: videoFiles });
        } catch (error) {
            console.error('Drive list error:', error);
            res.status(500).json({ success: false, message: 'Failed to list files from Drive' });
        }
    });

    // Get Topics (Admin)
    app.get('/api/classes/admin/topics', async (req, res) => {
        try {
            const { categoryId } = req.query;
            const db = await connectDB();
            const query = categoryId ? { categoryId } : {};
            const topics = await db.collection('classes_topics').find(query).sort({ order: 1 }).toArray();
            res.json({ success: true, data: topics });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Create Topic
    app.post('/api/classes/admin/topics', async (req, res) => {
        try {
            const { title, description, categoryId, driveFileId, thumbnail, duration, order, isPublished } = req.body;
            const db = await connectDB();
            const topic = {
                title, description, categoryId, driveFileId, thumbnail, duration,
                order: parseInt(order) || 0, isPublished: !!isPublished,
                createdAt: new Date()
            };
            const result = await db.collection('classes_topics').insertOne(topic);
            res.json({ success: true, data: { ...topic, _id: result.insertedId } });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Update Topic
    app.put('/api/classes/admin/topics/:id', async (req, res) => {
        try {
            const { title, description, categoryId, driveFileId, thumbnail, duration, order, isPublished } = req.body;
            const db = await connectDB();
            await db.collection('classes_topics').updateOne(
                { _id: new ObjectId(req.params.id) },
                { $set: { title, description, categoryId, driveFileId, thumbnail, duration, order: parseInt(order)||0, isPublished: !!isPublished, updatedAt: new Date() } }
            );
            res.json({ success: true, message: 'Topic updated' });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // Delete Topic
    app.delete('/api/classes/admin/topics/:id', async (req, res) => {
        try {
            const db = await connectDB();
            await db.collection('classes_topics').deleteOne({ _id: new ObjectId(req.params.id) });
            res.json({ success: true, message: 'Topic deleted' });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
};
