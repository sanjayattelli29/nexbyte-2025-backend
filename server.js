// DNS Loopback Fallback for Windows local development environments
const dns = require('dns');
try {
    const servers = dns.getServers();
    if (servers.length === 0 || servers.includes('127.0.0.1')) {
        dns.setServers(['8.8.8.8', '1.1.1.1', ...servers.filter(s => s !== '127.0.0.1')]);
        console.log("DNS servers overridden to Google/Cloudflare resolvers to avoid querySrv ECONNREFUSED.");
    }
} catch (e) {
    console.warn("Could not check or set DNS servers:", e.message);
}

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const ImageKit = require("imagekit");
require('dotenv').config();

const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "https://nexbyte-2025-frontend.vercel.app",
        "https://nexbyteind.com",
        "https://www.nexbyteind.com",
        "https://admin.nexbyteind.com"
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ImageKit Configuration
const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

// MongoDB Connection
// MongoDB Connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

async function connectDB() {
    if (db) return db;
    try {
        await client.connect();
        const dbName = process.env.DB_NAME || 'nexbyteind_db_user';
        db = client.db(dbName);
        console.log(`Connected to MongoDB: ${dbName}`);
        return db;
    } catch (err) {
        console.error("MongoDB connection error:", err);
        throw err;
    }
}

// Middleware to ensure DB connection
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        console.error("Failed to connect to DB in middleware:", error);
        res.status(500).json({ success: false, message: 'Database connection failed' });
    }
});

connectDB().catch(console.error);

// Serve static files (Admin Dashboard)
app.use(express.static('public'));

// Routes
require('./webinars')(app, connectDB);
require('./rewards')(app, connectDB);
require('./quiz')(app, connectDB);

// --- CONTACTS ---
app.get('/api/contacts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database not initialized' });
        const contacts = await db.collection('contacts').find().sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: contacts });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.post('/api/contact', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database not initialized' });
        const contactData = { ...req.body, submittedAt: new Date() };
        const result = await db.collection('contacts').insertOne(contactData);

        // Send Welcome Email
        await sendContactWelcomeEmail(contactData).catch(console.error);

        res.status(201).json({ success: true, message: 'Contact saved', id: result.insertedId });
    } catch (error) {
        console.error('Error saving contact:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- HACKATHONS ---
app.post('/api/hackathons', async (req, res) => {
    try {
        console.log('[POST /api/hackathons] Hit');
        console.log('Payload:', req.body);

        const database = await connectDB();
        const hackathonData = {
            name: req.body.name,
            type: req.body.type || 'Hackathon', // 'Hackathon' or 'Quiz'
            mode: req.body.mode,
            description: req.body.description,
            teamSize: req.body.teamSize || {
                min: parseInt(req.body.teamSizeMin),
                max: parseInt(req.body.teamSizeMax)
            },
            isPaid: req.body.isPaid,
            techStack: req.body.techStack,
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            registrationDeadline: req.body.registrationDeadline,
            helplineNumber: req.body.helplineNumber || "",
            organizerContact: req.body.organizerContact || "",
            whatsappGroupLink: req.body.whatsappGroupLink || "",
            prizeMoney: req.body.prizeMoney || "",
            benefits: req.body.benefits || "",
            enableApplyButton: req.body.enableApplyButton !== undefined ? req.body.enableApplyButton : true,
            enableQuizButton: req.body.enableQuizButton || false,
            quizButtonName: req.body.quizButtonName || "",
            quizButtonLink: req.body.quizButtonLink || "",
            linkedQuizId: req.body.linkedQuizId || null,
            quizStartTime: req.body.quizStartTime || null,
            createdAt: new Date(),
            status: 'active',
            isHidden: true // Default to hidden, admin must unhide manually
        };

        console.log('Creating hackathon with data:', hackathonData);

        const result = await database.collection('hackathons').insertOne(hackathonData);
        console.log('Hackathon created with ID:', result.insertedId);

        res.status(201).json({ success: true, message: 'Hackathon created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating hackathon:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

app.get('/api/hackathons', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const hackathons = await db.collection('hackathons').find({}).sort({ startDate: 1 }).toArray();
        res.status(200).json({ success: true, data: hackathons });
    } catch (error) {
        console.error('Error fetching hackathons:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/hackathons/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('hackathons').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Hackathon deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Hackathon not found' });
        }
    } catch (error) {
        console.error('Error deleting hackathon:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/hackathons/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('hackathons').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: 'Visibility updated' });
        } else {
            // It's possible the value was already set to what we requested, so no modification.
            // But if matchedCount is 0, then it wasn't found.
            if (result.matchedCount === 0) {
                res.status(404).json({ success: false, message: 'Hackathon not found' });
            } else {
                res.status(200).json({ success: true, message: 'Visibility unchanged' });
            }
        }
    } catch (error) {
        console.error('Error updating visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/hackathons/:id/status', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { status, winner, secondWinner, raffleWinners } = req.body;

        const updateData = { status: status };
        if (winner !== undefined) updateData.winner = winner;
        if (secondWinner !== undefined) updateData.secondWinner = secondWinner;
        if (raffleWinners !== undefined) updateData.raffleWinners = raffleWinners;
        if (status === 'completed') {
            updateData.isHidden = false;
        }

        const result = await db.collection('hackathons').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: 'Status updated' });
        } else {
            if (result.matchedCount === 0) {
                res.status(404).json({ success: false, message: 'Hackathon not found' });
            } else {
                res.status(200).json({ success: true, message: 'Status unchanged' });
            }
        }
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/hackathons/:id', async (req, res) => {
    try {
        console.log(`[PUT /api/hackathons/:id] Hit with ID: ${req.params.id}`);
        console.log(`Payload:`, req.body);

        if (!db) {
            console.error('Database not connected');
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            console.error(`Invalid ObjectId: ${id}`);
            return res.status(400).json({ success: false, message: 'Invalid ID format' });
        }

        const updateData = {
            name: req.body.name,
            type: req.body.type || 'Hackathon',
            mode: req.body.mode,
            description: req.body.description,
            teamSize: req.body.teamSize || {
                min: parseInt(req.body.teamSizeMin),
                max: parseInt(req.body.teamSizeMax)
            },
            isPaid: req.body.isPaid,
            techStack: req.body.techStack,
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            registrationDeadline: req.body.registrationDeadline,
            helplineNumber: req.body.helplineNumber,
            organizerContact: req.body.organizerContact,
            whatsappGroupLink: req.body.whatsappGroupLink,
            prizeMoney: req.body.prizeMoney,
            benefits: req.body.benefits,
            enableApplyButton: req.body.enableApplyButton,
            enableQuizButton: req.body.enableQuizButton,
            quizButtonName: req.body.quizButtonName,
            quizButtonLink: req.body.quizButtonLink,
            linkedQuizId: req.body.linkedQuizId || null,
            quizStartTime: req.body.quizStartTime || null,
            isHidden: true, // Reset to hidden on every update
            updatedAt: new Date()
        };

        console.log('Update Data:', updateData);

        const result = await db.collection('hackathons').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        console.log('Update Result:', result);

        if (result.matchedCount === 0) {
            console.warn(`Hackathon not found with ID: ${id}`);
            res.status(404).json({ success: false, message: 'Hackathon not found' });
        } else {
            console.log(`Hackathon updated successfully: ${id}`);
            res.status(200).json({ success: true, message: 'Hackathon updated' });
        }
    } catch (error) {
        console.error('Error updating hackathon:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});




// --- WEBINARS ROUTES ---
require('./webinars')(app, connectDB);

// --- CAREER GUIDANCE ROUTES ---
require('./career-guidance')(app, connectDB, sendEmail);



// --- NEW ROUTE: Get Unique Subcategories ---
app.get('/api/tech-posts/subcategories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { category } = req.query;
        const match = category ? { category: category } : {};

        const subcategories = await db.collection('tech_posts').distinct("subcategory", match);
        const filtered = subcategories.filter(s => s && s.trim() !== "");

        res.status(200).json({ success: true, data: filtered });
    } catch (error) {
        console.error('Error fetching subcategories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/tech-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const newPost = {
            ...req.body,
            createdAt: new Date(),
            likes: 0,
            shares: 0,
            comments: [],
            isHidden: true, // Hidden by default
            commentsHidden: false,
            subcategory: req.body.subcategory || ""
        };

        const result = await db.collection('tech_posts').insertOne(newPost);
        res.status(201).json({ success: true, message: 'Tech Post created', data: { ...newPost, _id: result.insertedId } });
    } catch (error) {
        console.error('Error creating tech post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/tech-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const { sort, category, date, subcategory } = req.query;
        let query = { isHidden: { $ne: true } }; // Default: show only visible

        if (category && category !== 'All') {
            query.category = category;
        }

        if (subcategory) {
            query.subcategory = subcategory;
        }

        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            query.createdAt = { $gte: startOfDay, $lte: endOfDay };
        }

        let sortOption = { createdAt: -1 }; // Default latest
        if (sort === 'popular') {
            sortOption = { likes: -1 };
        }

        const posts = await db.collection('tech_posts').find(query).sort(sortOption).toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching tech posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Route to get ALL tech posts (including hidden)
app.get('/api/admin/tech-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const { sort, category } = req.query;
        let query = {};

        if (category && category !== 'All') {
            query.category = category;
        }

        let sortOption = { createdAt: -1 };
        if (sort === 'popular') {
            sortOption = { likes: -1 };
        }

        const posts = await db.collection('tech_posts').find(query).sort(sortOption).toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching admin tech posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// Get Single Tech Post
app.get('/api/tech-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const post = await db.collection('tech_posts').findOne({ _id: new ObjectId(id) });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, data: post });
    } catch (error) {
        console.error('Error fetching tech post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/tech-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { type, payload } = req.body;

        let updateData = {};

        if (type === 'like') {
            updateData = { $inc: { likes: 1 } };
        } else if (type === 'share') {
            updateData = { $inc: { shares: 1 } };
        } else if (type === 'comment') {
            updateData = { $push: { comments: payload } };
        } else if (type === 'visibility') {
            updateData = { $set: { isHidden: payload.isHidden } };
        } else if (type === 'comments-toggle') {
            updateData = { $set: { commentsHidden: payload.commentsHidden } };
        } else if (type === 'edit') {
            updateData = { $set: { ...payload, isHidden: true } }; // Enforce hidden on edit
        }

        const result = await db.collection('tech_posts').updateOne(
            { _id: new ObjectId(id) },
            updateData
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, message: 'Post updated' });
    } catch (error) {
        console.error('Error updating tech post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/tech-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const result = await db.collection('tech_posts').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, message: 'Post deleted' });
    } catch (error) {
        console.error('Error deleting tech post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- TECH SUBCATEGORIES ---

app.get('/api/tech-subcategories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { category, includeHidden } = req.query; // category is the Parent Category (e.g., "Python")

        const query = {};
        if (category) query.parentCategory = category;
        if (includeHidden !== 'true') query.isHidden = { $ne: true };

        const subcategories = await db.collection('tech_subcategories').find(query).toArray();
        res.status(200).json({ success: true, data: subcategories });
    } catch (error) {
        console.error('Error fetching tech subcategories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/tech-subcategories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { name, parentCategory } = req.body;

        if (!name || !parentCategory) {
            return res.status(400).json({ success: false, message: 'Name and Parent Category are required' });
        }

        const newSub = {
            name,
            parentCategory,
            isHidden: false,
            createdAt: new Date()
        };

        const result = await db.collection('tech_subcategories').insertOne(newSub);
        res.status(201).json({ success: true, data: { ...newSub, _id: result.insertedId }, message: 'Subcategory created' });
    } catch (error) {
        console.error('Error creating tech subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/tech-subcategories/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('tech_subcategories').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Subcategory not found' });
        res.status(200).json({ success: true, message: 'Subcategory deleted' });
    } catch (error) {
        console.error('Error deleting tech subcategory:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/tech-subcategories/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('tech_subcategories').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Subcategory not found' });
        res.status(200).json({ success: true, message: 'Visibility updated' });
    } catch (error) {
        console.error('Error updating subcategory visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- EXCLUSIVE DATA (Google Reviews Marketing) ---

app.post('/api/exclusive-data', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const entry = {
            ...req.body,
            submittedAt: new Date()
        };
        const result = await db.collection('exclusive_data').insertOne(entry);

        // Send Email Notification
        const mailOptions = {
            from: process.env.SMTP_EMAIL,
            to: process.env.SMTP_EMAIL, // Send to admin
            subject: `New Google Reviews Lead: ${req.body.businessName}`,
            html: `
                <h2>New Exclusive Data Lead</h2>
                <p><strong>Full Name:</strong> ${req.body.fullName}</p>
                <p><strong>Business Name:</strong> ${req.body.businessName}</p>
                <p><strong>WhatsApp:</strong> ${req.body.whatsappNumber}</p>
                <p><strong>Email:</strong> ${req.body.email || 'N/A'}</p>
                <p><strong>Location:</strong> ${req.body.location}</p>
                <p><strong>Start Date:</strong> ${req.body.startDate}</p>
                <p><strong>Maps Link:</strong> <a href="${req.body.mapsLink}">${req.body.mapsLink}</a></p>
                <p><strong>Message:</strong> ${req.body.message || 'N/A'}</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending email:', error);
            } else {
                console.log('Email sent: ' + info.response);
            }
        });

        res.status(201).json({ success: true, message: 'Data saved', id: result.insertedId });
    } catch (error) {
        console.error('Error saving exclusive data:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/exclusive-data', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const data = await db.collection('exclusive_data').find().sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: data });
    } catch (error) {
        console.error('Error fetching exclusive data:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/exclusive-data/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('exclusive_data').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) res.status(200).json({ success: true, message: 'Deleted' });
        else res.status(404).json({ success: false, message: 'Not Found' });
    } catch (error) {
        console.error('Error deleting exclusive data:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- APPLICATIONS ---

// --- EMAIL CONFIGURATION ---
// const nodemailer = require('nodemailer'); // Already declared at top

const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    auth: {
        user: process.env.BREVO_SMTP_USER,
        pass: process.env.BREVO_SMTP_KEY
    }
});

// --- CLASSES ROUTES ---
require('./classes')(app, connectDB, transporter);

// Helper to send generic email
// Helper to send generic email
async function sendEmail(toEmail, subject, htmlContent) {
    if (!toEmail) {
        console.error('[sendEmail] Error: No recipient email provided.');
        return;
    }

    console.log(`[sendEmail] Attempting to send email to: ${toEmail}, Subject: ${subject}`);

    const mailOptions = {
        from: `"NexByte Team" <${process.env.SMTP_EMAIL}>`,
        to: toEmail,
        subject: subject,
        html: htmlContent
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[sendEmail] Success! Email sent to ${toEmail}. MessageID: ${info.messageId}`);
    } catch (error) {
        console.error(`[sendEmail] Failed to send email to ${toEmail}. Error:`, error);
        throw error; // Propagate error so callers know it failed
    }
}

// Template Generators
const getHackathonWelcomeTemplate = (participantName, hackathonName, whatsappLink) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #2563eb;">Welcome to ${hackathonName}!</h2>
        <p>Hello <strong>${participantName}</strong>,</p>
        <p>Thanks for registering! We are excited to have you.</p>
        
        ${whatsappLink ? `
        <div style="background-color: #dcfce7; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; color: #166534; font-weight: bold;">Join the Official WhatsApp Group</p>
            <a href="${whatsappLink}" style="display: inline-block; margin-top: 10px; background-color: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Join Group Now
            </a>
            <p style="margin-top: 10px; font-size: 12px; color: #555;">Or click here: <a href="${whatsappLink}">${whatsappLink}</a></p>
        </div>
        ` : ''}

        <p>Stay tuned for further updates.</p>
        <p>Best Regards,<br/><strong>Team NexByte</strong></p>
    </div>
`;

const getProgramEmailTemplate = (name, title, type, whatsappLink) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #7c3aed;">Application Received: ${title}</h2>
        <p>Dear <strong>${name}</strong>,</p>
        <p>Thank you for applying for the <strong>${type}</strong> program at NexByte.</p>
        <p>We have received your application and our team is currently reviewing it.</p>
        
        ${whatsappLink ? `
        <div style="background-color: #dcfce7; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; color: #166534; font-weight: bold;">Join the Official WhatsApp Group</p>
            <a href="${whatsappLink}" style="display: inline-block; margin-top: 10px; background-color: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                Join Group Now
            </a>
            <p style="margin-top: 10px; font-size: 12px; color: #555;">Or click here: <a href="${whatsappLink}">${whatsappLink}</a></p>
        </div>
        ` : ''}

        <p>You will receive further instructions shortly regarding the next steps.</p>
        <br/>
        <p>Best Regards,<br/><strong>NexByte Learning Team</strong></p>
    </div>
`;

const getStaffingEmailTemplate = (contactPerson, serviceCategory) => {
    let specificMessage = "";
    switch (serviceCategory) {
        case "IT Staffing":
            specificMessage = "We are reviewing your requirements for IT staffing. Our team will get back to you with profiles that match your needs.";
            break;
        case "Contract Hiring":
            specificMessage = "Thank you for choosing our Contract Hiring services. We will connect with you to discuss the contract duration and resource availability.";
            break;
        case "Full-Time Recruitment":
            specificMessage = "We acknowledge your request for Full-Time Recruitment. Our talent acquisition specialists will scrutinize the best candidates for your organization.";
            break;
        case "Talent Screening":
            specificMessage = "We have received your request for Talent Screening. We will proceed with the validation process as per your specified metrics.";
            break;
        default:
            specificMessage = "We have received your staffing request and will get back to you shortly.";
    }

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #0d9488;">${serviceCategory} Request Received</h2>
        <p>Dear <strong>${contactPerson}</strong>,</p>
        <p>Thank you for reaching out to NexByte for <strong>${serviceCategory}</strong>.</p>
        <p style="background-color: #f0fdfa; padding: 15px; border-radius: 5px; border-left: 4px solid #0d9488;">
            ${specificMessage}
        </p>
        <p>A representative will contact you within 24 hours.</p>
        <br/>
        <p>Best Regards,<br/><strong>NexByte Business Solutions</strong></p>
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; color: #333; line-height: 1.6;">
        <!-- Header -->
        <div style="background-color: ${config.color}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">${serviceCategory}</h1>
            <p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px;">${config.description}</p>
        </div>

        <!-- Body -->
        <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; background-color: #fff;">
            <p style="font-size: 16px;">Hello <strong>${commonDetails.fullName}</strong>,</p>
            <p style="font-size: 16px; color: #555;">Thank you for your interest in our <strong>${serviceCategory}</strong> services. We have received your project details and our technical team is reviewing them.</p>

            <!-- Features -->
            <div style="margin: 25px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
                <h3 style="margin-top: 0; color: ${config.color};">Why NexByte for ${serviceCategory}?</h3>
                <ul style="padding-left: 20px; margin-bottom: 0;">
                    ${config.features.map(f => `<li style="margin-bottom: 5px;">${f}</li>`).join('')}
                </ul>
            </div>

            <!-- Submission Summary -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <h3 style="color: #1f2937; margin-bottom: 15px;">Your Submission Details</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Company:</strong> ${commonDetails.companyName || 'N/A'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Timeline:</strong> ${commonDetails.timeline || 'Flexible'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Budget:</strong> ${commonDetails.budgetRange || 'Not specified'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Phone:</strong> ${commonDetails.phone}</p>
                    </div>
                    <div>
                       ${specificDetailsHtml}
                    </div>
                </div>
                 <p style="margin: 15px 0 5px; font-size: 14px;"><strong>Project Brief:</strong></p>
                 <p style="margin: 0; font-size: 14px; font-style: italic; color: #666;">"${commonDetails.projectBrief}"</p>
            </div>
        </div>

        <!-- Big Footer (Contact & Socials) -->
        <div style="background-color: #111827; color: white; padding: 40px 30px; border-radius: 0 0 12px 12px; text-align: center;">
            <h3 style="margin-top: 0; color: #fff;">Need immediate assistance?</h3>
            <p style="color: #9ca3af; margin-bottom: 30px;">Contact us via any of the channels below.</p>

            <!-- Contact Info -->
             <div style="margin-bottom: 30px; font-size: 14px;">
                <p style="margin: 5px 0;">📞 <strong>Phone:</strong> 8247872473</p>
                <p style="margin: 5px 0;">📧 <strong>Email:</strong> nexbyteind@gmail.com | lokesh@nexbyte.com</p>
            </div>

            <!-- Social Links Grid -->
            <div style="display: inline-flex; gap: 15px; flex-wrap: wrap; justify-content: center;">
                <a href="https://www.linkedin.com/company/nexbyte-services/" style="background: #0077b5; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">LinkedIn</a>
                <a href="https://www.instagram.com/nexbyte_tech?igsh=OWJpZnZjd25hZ2p5&utm_source=qr" style="background: #E1306C; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Instagram</a>
                <a href="https://x.com/nexbyteind" style="background: #000; border: 1px solid #333; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">X (Twitter)</a>
                <a href="https://youtube.com/@nexbyteind?si=XET9tJAyE4lWN413" style="background: #FF0000; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">YouTube</a>
                <a href="https://www.facebook.com/profile.php?id=61584986327411" style="background: #1877F2; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Facebook</a>
            </div>

            <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">&copy; ${new Date().getFullYear()} NexByte Services. All rights reserved.</p>
        </div>
    </div>
    `;
};


const getTechnologyEmailTemplate = (data) => {
    const { serviceCategory, commonDetails, serviceDetails } = data;

    // Service Specific Content Config- (Same as before)
    const servicesConfig = {
        "Web Development": {
            color: "#3b82f6", // Blue
            description: "Modern, responsive, and high-performance websites built with the latest technologies.",
            features: ["React/Next.js", "SEO Optimized", "Fast Performance", "Mobile Responsive"]
        },
        "Custom Software Development": {
            color: "#8b5cf6", // Purple
            description: "Tailored software solutions designed to meet your specific business needs and workflows.",
            features: ["Scalable architecture", "Custom features", "Integration support", "Maintenance included"]
        },
        "App Development": {
            color: "#10b981", // Emerald
            description: "Native and cross-platform mobile applications for iOS and Android.",
            features: ["Flutter/React Native", "User-friendly UI/UX", "App Store Deployment", "Push Notifications"]
        },
        "UI / UX Design": {
            color: "#ec4899", // Pink
            description: "User-centric design services for websites and mobile applications.",
            features: ["Figma Design", "Prototyping", "User Research", "Brand Consistency"]
        },
        "IT Consulting": {
            color: "#f59e0b", // Amber
            description: "Expert guidance on digital transformation and technology strategy.",
            features: ["Tech Stack Selection", "Process Automation", "System Architecture", "Legacy Modernization"]
        },
        "Cloud Solutions": {
            color: "#0ea5e9", // Sky
            description: "Secure and scalable cloud infrastructure setup and management.",
            features: ["AWS/Azure/GCP", "Cloud Migration", "Cost Optimization", "Security Audits"]
        }
    };

    const config = servicesConfig[serviceCategory] || { color: "#333", description: "Technology Services", features: [] };

    // Formatting Specific Details
    const specificDetailsHtml = Object.entries(serviceDetails).map(([key, value]) => {
        // Humanize key (e.g. softwareType -> Software Type)
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        return `<p style="margin: 5px 0; font-size: 14px;"><strong>${label}:</strong> ${value}</p>`;
    }).join('');

    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; color: #333; line-height: 1.6;">
        <!-- Header -->
        <div style="background-color: ${config.color}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">${serviceCategory}</h1>
            <p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px;">${config.description}</p>
        </div>

        <!-- Body -->
        <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; background-color: #fff;">
            <p style="font-size: 16px;">Hello <strong>${commonDetails.fullName}</strong>,</p>
            <p style="font-size: 16px; color: #555;">Thank you for your interest in our <strong>${serviceCategory}</strong> services. We have received your project details and our technical team is reviewing them.</p>

            <!-- Features -->
            <div style="margin: 25px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px;">
                <h3 style="margin-top: 0; color: ${config.color};">Why NexByte for ${serviceCategory}?</h3>
                <ul style="padding-left: 20px; margin-bottom: 0;">
                    ${config.features.map(f => `<li style="margin-bottom: 5px;">${f}</li>`).join('')}
                </ul>
            </div>

            <!-- Submission Summary -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <h3 style="color: #1f2937; margin-bottom: 15px;">Your Submission Details</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Company:</strong> ${commonDetails.companyName || 'N/A'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Timeline:</strong> ${commonDetails.timeline || 'Flexible'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Budget:</strong> ${commonDetails.budgetRange || 'Not specified'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Phone:</strong> ${commonDetails.phone}</p>
                    </div>
                    <div>
                       ${specificDetailsHtml}
                    </div>
                </div>
                 <p style="margin: 15px 0 5px; font-size: 14px;"><strong>Project Brief:</strong></p>
                 <p style="margin: 0; font-size: 14px; font-style: italic; color: #666;">"${commonDetails.projectBrief}"</p>
            </div>
        </div>

        <!-- Big Footer (Contact & Socials) -->
        <div style="background-color: #111827; color: white; padding: 40px 30px; border-radius: 0 0 12px 12px; text-align: center;">
            <h3 style="margin-top: 0; color: #fff;">Need immediate assistance?</h3>
            <p style="color: #9ca3af; margin-bottom: 30px;">Contact us via any of the channels below.</p>

            <!-- Contact Info -->
             <div style="margin-bottom: 30px; font-size: 14px;">
                <p style="margin: 5px 0;">📞 <strong>Phone:</strong> 8247872473</p>
                <p style="margin: 5px 0;">📧 <strong>Email:</strong> nexbyteind@gmail.com | lokesh@nexbyte.com</p>
            </div>

            <!-- Social Links Grid -->
            <div style="display: inline-flex; gap: 15px; flex-wrap: wrap; justify-content: center;">
                <a href="https://www.linkedin.com/company/nexbyte-services/" style="background: #0077b5; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">LinkedIn</a>
                <a href="https://www.instagram.com/nexbyte_tech?igsh=OWJpZnZjd25hZ2p5&utm_source=qr" style="background: #E1306C; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Instagram</a>
                <a href="https://x.com/nexbyteind" style="background: #000; border: 1px solid #333; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">X (Twitter)</a>
                <a href="https://youtube.com/@nexbyteind?si=XET9tJAyE4lWN413" style="background: #FF0000; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">YouTube</a>
                <a href="https://www.facebook.com/profile.php?id=61584986327411" style="background: #1877F2; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Facebook</a>
            </div>

            <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">&copy; ${new Date().getFullYear()} NexByte Services. All rights reserved.</p>
        </div>
    </div>
    `;
};

const getContactWelcomeTemplate = (firstName) => `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6; background-color:#f9fafb; padding:10px;">

  <!-- Header -->
  <div style="background-color: #2563eb; padding: 30px; border-radius: 14px 14px 0 0; text-align: center; color: white;">
    <h1 style="margin: 0; font-size: 28px;">Welcome to NexByte 👋</h1>
    <p style="margin: 12px 0 0; opacity: 0.95; font-size: 16px;">
      Your partner in Digital Growth & Technology Innovation
    </p>
  </div>

  <!-- Body -->
  <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; background-color: #ffffff;">
    
    <p style="font-size: 16px;">Hello <strong>${firstName}</strong>,</p>

    <p style="font-size: 16px; color: #555;">
      Thank you for connecting with <strong>NexByte Services</strong>.  
      We’ve successfully received your inquiry and our team is already reviewing it.
    </p>

    <p style="font-size: 16px; color: #555;">
      One of our experts will reach out to you within <strong>24 hours</strong> to understand your requirements and help you move forward confidently.
    </p>

    <!-- Website CTA -->
    <div style="text-align:center; margin: 25px 0;">
      <a href="https://www.nexbyteind.com/"
         style="display:inline-block; background:#2563eb; color:#fff; padding:12px 22px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:14px;">
        Visit Our Website 🌐
      </a>
    </div>

    <!-- Services Section -->
    <div style="margin: 30px 0; padding: 22px; background-color: #f3f4f6; border-radius: 10px;">
      <h3 style="margin-top: 0; color: #2563eb; text-align: center;">Our Core Services</h3>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px;">

        <a href="https://www.nexbyteind.com/services/marketing"
           style="background:#fff; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-size:14px; font-weight:bold; color:#374151;">
           📈 Digital Marketing
        </a>

        <a href="https://www.nexbyteind.com/services/technology"
           style="background:#fff; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-size:14px; font-weight:bold; color:#374151;">
           💻 Technology Solutions
        </a>

        <a href="https://www.nexbyteind.com/services/staffing"
           style="background:#fff; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-size:14px; font-weight:bold; color:#374151;">
           👥 Staffing & Hiring
        </a>

        <a href="https://www.nexbyteind.com/services/training"
           style="background:#fff; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-size:14px; font-weight:bold; color:#374151;">
           🎓 Training Programs
        </a>

        <a href="https://www.nexbyteind.com/services/hackathons"
           style="grid-column: span 2; background:#fff; padding:12px; border-radius:8px; text-align:center; text-decoration:none; font-size:14px; font-weight:bold; color:#374151;">
           🚀 Hackathons & Innovation Events
        </a>

      </div>
    </div>

    <!-- Highlight Events -->
    <div style="margin: 30px 0; padding: 22px; background: linear-gradient(135deg,#2563eb,#1e40af); border-radius: 12px; text-align:center; color:#fff;">
      <h3 style="margin:0 0 10px;">✨ Upcoming Events & Programs</h3>
      <p style="margin:0 0 16px; font-size:14px; opacity:0.95;">
        Workshops • Hackathons • Live Training • Community Events
      </p>
      <a href="https://www.nexbyteind.com/events"
         style="display:inline-block; background:#ffffff; color:#1e40af; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:14px;">
        Explore Events →
      </a>
    </div>

    <!-- Contact CTA -->
    <div style="text-align:center; margin-top:30px;">
      <p style="font-weight:bold; color:#1f2937;">Need immediate assistance?</p>
      <a href="https://www.nexbyteind.com/contact"
         style="display:inline-block; margin-top:8px; background:#10b981; color:#ffffff; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold; font-size:14px;">
         Contact Us
      </a>
    </div>

    <!-- Social Links -->
    <div style="text-align: center; margin-top: 35px;">
      <p style="font-weight: bold; color: #1f2937; margin-bottom: 18px;">Connect With Us</p>
      <div style="display: inline-flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        <a href="https://www.linkedin.com/company/nexbyte-services/" style="background:#0077b5; color:#fff; text-decoration:none; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:bold;">LinkedIn</a>
        <a href="https://www.instagram.com/nexbyte_tech?igsh=OWJpZnZjd25hZ2p5&utm_source=qr" style="background:#E1306C; color:#fff; text-decoration:none; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:bold;">Instagram</a>
        <a href="https://x.com/nexbyteind" style="background:#000; color:#fff; text-decoration:none; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:bold;">X</a>
        <a href="https://youtube.com/@nexbyteind?si=XET9tJAyE4lWN413" style="background:#FF0000; color:#fff; text-decoration:none; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:bold;">YouTube</a>
        <a href="https://www.facebook.com/profile.php?id=61584986327411" style="background:#1877F2; color:#fff; text-decoration:none; padding:8px 12px; border-radius:6px; font-size:12px; font-weight:bold;">Facebook</a>
      </div>
    </div>

  </div>

  <!-- Footer -->
  <div style="background-color: #111827; color: white; padding: 18px; border-radius: 0 0 14px 14px; text-align: center; font-size: 12px;">
    <p style="margin: 0; color: #9ca3af;">
      © ${new Date().getFullYear()} NexByte Services. All rights reserved.
    </p>
  </div>

</div>
`;


const getMarketingEmailTemplate = (data) => {
    const { clientDetails, digitalMarketingRequirements } = data;
    const serviceTitle = clientDetails.selectedService || "Digital Marketing";

    // Marketing Service Config
    const marketingConfig = {
        "Social Media Management": {
            color: "#ec4899",
            desc: "End-to-end management with content planning, scheduling, and community engagement."
        },
        "Social Media Ads": {
            color: "#8b5cf6",
            desc: "Strategic paid campaigns with targeting, A/B testing, and ROI optimization."
        },
        "Video Content Strategy": {
            color: "#ef4444",
            desc: "Engaging video content optimized for Reels, Shorts, and long-form platforms."
        },
        "Audience Growth": {
            color: "#10b981",
            desc: "Organic strategies to build a loyal community and increase followers."
        },
        "Branding & Design": {
            color: "#f59e0b",
            desc: "Complete identity design including logos, color palettes, and brand guidelines."
        }
    };
    const config = marketingConfig[serviceTitle] || { color: "#ec4899", desc: "Marketing Services" };

    // Format Requirements
    // digitalMarketingRequirements can have nested objects (like platforms). We flatten mostly for email.
    let reqsHtml = ``;
    if (digitalMarketingRequirements.serviceType) reqsHtml += `<p style="margin: 5px 0;"><strong>Service Type:</strong> ${digitalMarketingRequirements.serviceType}</p>`;

    // Handle platforms object if exists
    if (digitalMarketingRequirements.platforms) {
        if (Array.isArray(digitalMarketingRequirements.platforms)) {
            reqsHtml += `<p style="margin: 5px 0;"><strong>Platforms:</strong> ${digitalMarketingRequirements.platforms.join(', ')}</p>`;
        } else {
            const plats = Object.keys(digitalMarketingRequirements.platforms).join(', ');
            reqsHtml += `<p style="margin: 5px 0;"><strong>Platforms:</strong> ${plats}</p>`;
        }
    }

    // Other common fields
    if (digitalMarketingRequirements.monthlyAdSpend) reqsHtml += `<p style="margin: 5px 0;"><strong>Ad Spend:</strong> ${digitalMarketingRequirements.monthlyAdSpend}</p>`;
    if (digitalMarketingRequirements.adObjective) reqsHtml += `<p style="margin: 5px 0;"><strong>Objective:</strong> ${digitalMarketingRequirements.adObjective}</p>`;

    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; color: #333; line-height: 1.6;">
        <!-- Header -->
        <div style="background-color: ${config.color}; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">${serviceTitle}</h1>
            <p style="margin: 10px 0 0; opacity: 0.9; font-size: 16px;">${config.desc}</p>
        </div>

        <!-- Body -->
        <div style="padding: 30px; border: 1px solid #e5e7eb; border-top: none; background-color: #fff;">
            <p style="font-size: 16px;">Hello <strong>${clientDetails.fullName}</strong>,</p>
            <p style="font-size: 16px; color: #555;">Thank you for your interest in our <strong>${serviceTitle}</strong> services. Our marketing strategists are reviewing your requirements.</p>

            <!-- Submission Summary -->
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
                <h3 style="color: #1f2937; margin-bottom: 15px;">Your Marketing Inquiry</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Business:</strong> ${clientDetails.businessName || 'N/A'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Budget:</strong> ${clientDetails.monthlyBudgetRange || 'N/A'}</p>
                        <p style="margin: 5px 0; font-size: 14px;"><strong>Goal:</strong> ${clientDetails.primaryGoal || 'N/A'}</p>
                    </div>
                    <div style="font-size: 14px;">
                       ${reqsHtml}
                    </div>
                </div>
                 <p style="margin: 15px 0 5px; font-size: 14px;"><strong>Additional Notes:</strong></p>
                 <p style="margin: 0; font-size: 14px; font-style: italic; color: #666;">"${clientDetails.additionalNotes}"</p>
            </div>
        </div>

        <!-- Big Footer (Contact & Socials) -->
        <div style="background-color: #111827; color: white; padding: 40px 30px; border-radius: 0 0 12px 12px; text-align: center;">
            <h3 style="margin-top: 0; color: #fff;">Boost your brand with NexByte!</h3>
            <p style="color: #9ca3af; margin-bottom: 30px;">Connect with us for more insights.</p>

            <!-- Contact Info -->
             <div style="margin-bottom: 30px; font-size: 14px;">
                <p style="margin: 5px 0;">📞 <strong>Phone:</strong> 8247872473</p>
                <p style="margin: 5px 0;">📧 <strong>Email:</strong> nexbyteind@gmail.com | lokesh@nexbyte.com</p>
            </div>

            <!-- Social Links Grid -->
            <div style="display: inline-flex; gap: 15px; flex-wrap: wrap; justify-content: center;">
                <a href="https://www.linkedin.com/company/nexbyte-services/" style="background: #0077b5; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">LinkedIn</a>
                <a href="https://www.instagram.com/nexbyte_tech?igsh=OWJpZnZjd25hZ2p5&utm_source=qr" style="background: #E1306C; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Instagram</a>
                <a href="https://x.com/nexbyteind" style="background: #000; border: 1px solid #333; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">X (Twitter)</a>
                <a href="https://youtube.com/@nexbyteind?si=XET9tJAyE4lWN413" style="background: #FF0000; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">YouTube</a>
                <a href="https://www.facebook.com/profile.php?id=61584986327411" style="background: #1877F2; color: white; text-decoration: none; padding: 10px 15px; border-radius: 5px; font-size: 13px; font-weight: bold;">Facebook</a>
            </div>

            <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">&copy; ${new Date().getFullYear()} NexByte Services. All rights reserved.</p>
        </div>
    </div>
    `;
};


// --- APPLICATIONS ---
app.post('/api/applications', async (req, res) => {
    console.log('[API] Received hackathon application request:', req.body.email);
    try {
        const database = await connectDB();
        const applicationData = {
            ...req.body,
            submittedAt: new Date()
        };

        const result = await database.collection('applications').insertOne(applicationData);

        // Send Welcome Email (Hackathons)
        if (req.body.hackathonId) {
            const hackathon = await database.collection('hackathons').findOne({ _id: new ObjectId(req.body.hackathonId) });
            if (hackathon) {
                await sendHackathonWelcomeEmail(req.body, hackathon).catch(err => console.error("Async email error:", err));
            }
        }

        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- PROGRAMS (Trainings & Internships) ---
app.post('/api/programs', async (req, res) => {
    try {
        console.log('[POST /api/programs] Hit');
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const programData = {
            ...req.body,
            createdAt: new Date(),
            status: req.body.status || 'Active',
            isHidden: true // Default to hidden
        };
        console.log('Creating program (hidden):', programData);
        const result = await db.collection('programs').insertOne(programData);
        res.status(201).json({ success: true, message: 'Program created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating program:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});



// --- NEWS & PRIVATE ADS SYSTEM (Linked from news.js) ---
require('./news')(app, connectDB);


app.get('/api/programs', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        // Optional filter by type if needed via query param ?type=Internship
        const query = {};
        if (req.query.type) {
            query.type = req.query.type;
        }

        const programs = await db.collection('programs').find(query).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: programs });
    } catch (error) {
        console.error('Error fetching programs:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/programs/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('programs').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Program deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Program not found' });
        }
    } catch (error) {
        console.error('Error deleting program:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/programs/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('programs').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Program not found' });
        } else {
            res.status(200).json({ success: true, message: 'Visibility updated' });
        }
    } catch (error) {
        console.error('Error updating program visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/programs/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const updateData = {
            ...req.body,
            isHidden: true, // Force hidden on update
            updatedAt: new Date()
        };
        // Remove _id if present in body to avoid conflict
        delete updateData._id;

        console.log('Updating program (forcing hidden):', updateData);

        const result = await db.collection('programs').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Program not found' });
        } else {
            res.status(200).json({ success: true, message: 'Program updated' });
        }
    } catch (error) {
        console.error('Error updating program:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- PROGRAM APPLICATIONS ---
app.post('/api/program-applications', async (req, res) => {
    console.log('[API] Received program application request:', req.body.email);
    try {
        const database = await connectDB();
        const applicationData = {
            ...req.body,
            submittedAt: new Date()
        };
        const result = await database.collection('program_applications').insertOne(applicationData);

        // Fetch program details for email
        let programTitle = "Program";
        let whatsappLink = "";
        // programType should be passed from frontend ("Training" or "Internship")
        const collectionName = 'programs';
        let programId = req.body.trainingId || req.body.internshipId;

        if (programId) {
            const program = await database.collection(collectionName).findOne({ _id: new ObjectId(programId) });
            if (program) {
                programTitle = program.title;
                whatsappLink = program.whatsappGroupLink;
            }
        }

        await sendProgramApplicationEmail(req.body, programTitle, whatsappLink, req.body.programType).catch(console.error);

        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting program application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/program-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('program_applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching program applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- TECHNOLOGY APPLICATIONS ---
app.post('/api/technology-applications', async (req, res) => {
    try {
        const database = await connectDB();
        const applicationData = {
            ...req.body,
            submittedAt: new Date(),
            status: 'New' // New, In Progress, Completed
        };
        const result = await database.collection('technology_applications').insertOne(applicationData);

        // Send Email
        await sendTechApplicationEmail(req.body).catch(console.error);

        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting technology application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/technology-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('technology_applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching technology applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- STAFFING APPLICATIONS ---
app.post('/api/staffing-applications', async (req, res) => {
    try {
        const database = await connectDB();
        const applicationData = {
            ...req.body,
            submittedAt: new Date(),
            status: 'New'
        };
        const result = await database.collection('staffing_applications').insertOne(applicationData);

        // Send Email
        await sendStaffingApplicationEmail(req.body).catch(console.error);

        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting staffing application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/staffing-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('staffing_applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching staffing applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});



// --- REUSABLE EMAIL HELPERS ---

async function sendHackathonWelcomeEmail(application, hackathon) {
    if (!hackathon) return;
    const recipientEmail = application.participantType === 'Team' ? application.leader?.email : application.email;
    const recipientName = application.participantType === 'Team' ? application.leader?.fullName : application.fullName;
    const html = getHackathonWelcomeTemplate(recipientName, hackathon.name, hackathon.whatsappGroupLink);
    await sendEmail(recipientEmail, `Welcome to ${hackathon.name}! 🚀`, html);
}

async function sendProgramApplicationEmail(application, programTitle, whatsappLink, programType) {
    const subject = `Application Received: ${programTitle}`;
    const html = getProgramEmailTemplate(application.fullName, programTitle, programType || "Program", whatsappLink);
    await sendEmail(application.email, subject, html);
}

async function sendTechApplicationEmail(application) {
    const email = application.commonDetails?.email;
    if (email) {
        const subject = `${application.serviceCategory} Enquiry via NexByte Technology`;
        const html = getTechnologyEmailTemplate(application);
        await sendEmail(email, subject, html);
    }
}

async function sendStaffingApplicationEmail(application) {
    const contactPerson = application.companyDetails?.contactPerson || "User";
    const email = application.companyDetails?.email;
    const serviceCategory = application.serviceCategory || "Staffing Service";
    if (email) {
        const subject = `${serviceCategory} Request Received - NexByte`;
        const html = getStaffingEmailTemplate(contactPerson, serviceCategory);
        await sendEmail(email, subject, html);
    }
}

async function sendMarketingApplicationEmail(application) {
    const email = application.clientDetails?.email;
    if (email) {
        const subject = `Marketing Inquiry Received: ${application.clientDetails?.selectedService || 'Digital Marketing'}`;
        const html = getMarketingEmailTemplate(application);
        await sendEmail(email, subject, html);
    }
}

async function sendContactWelcomeEmail(contact) {
    const email = contact.email;
    if (email) {
        const subject = "Welcome to NexByte! We've received your message 🚀";
        const html = getContactWelcomeTemplate(contact.firstName);
        await sendEmail(email, subject, html);
    }
}

function getTrainingEmailTemplate(name, trainingName) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 24px; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; }
            .greeting { font-size: 18px; color: #1e293b; margin-bottom: 20px; }
            .message { color: #475569; margin-bottom: 25px; }
            .details-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 14px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #6366f1; color: white !important; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 15px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Registration Confirmed! 🎓</h1>
        </div>
        <div class="content">
            <h2 class="greeting">Hello ${name},</h2>
            <p class="message">Thank you for registering for <strong>${trainingName}</strong> at NexByte! We are excited to have you on board to upgrade your skills.</p>
            <div class="details-box">
                <p><strong>Training:</strong> ${trainingName}</p>
                <p><strong>Mode:</strong> Online / Hybrid</p>
                <p><strong>Status:</strong> Registration Successful</p>
            </div>
            <p class="message">Our team will reach out to you shortly with the schedule and joining details.</p>
            <a href="https://www.nexbyteind.com" class="button">Visit Dashboard</a>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} NexByte. All rights reserved.</p>
            <p>If you have any questions, reply to this email.</p>
        </div>
    </body>
    </html>
    `;
}

async function sendTrainingApplicationEmail(application, trainingName) {
    const email = application.email;
    if (email) {
        const adminHtml = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <h2 style="color: #6366f1;">New Training Application 🚀</h2>
                <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <p><strong>Training:</strong> ${trainingName}</p>
                    <p><strong>Applicant:</strong> ${application.applicantName}</p>
                    <p><strong>Email:</strong> ${application.email}</p>
                    
                    <h4 style="border-bottom: 2px solid #6366f1; padding-bottom: 5px; margin-top: 20px;">Submission Details:</h4>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        ${Object.entries(application.dynamicData || {}).map(([key, value]) => `
                            <tr>
                                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 40%;">${key}</td>
                                <td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                <p style="margin-top: 20px; font-size: 12px; color: #64748b;">Sent via NexByte Admin System</p>
            </div>
        </body>
        </html>
        `;

        // Send User Confirmation
        const userHtml = getTrainingEmailTemplate(application.applicantName || "Learner", trainingName);
        await sendEmail(email, `Registration Confirmed: ${trainingName} 🎓`, userHtml);

        // Send Admin Notification
        await sendEmail(process.env.BREVO_SENDER_EMAIL, `New Applicant: ${trainingName}`, adminHtml);
    }
}








// --- RESEND EMAIL ENDPOINTS ---

app.post('/api/applications/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const application = await db.collection('applications').findOne({ _id: new ObjectId(id) });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        const hackathon = await db.collection('hackathons').findOne({ _id: new ObjectId(application.hackathonId) });
        if (!hackathon) return res.status(404).json({ success: false, message: 'Hackathon not found' });

        await sendHackathonWelcomeEmail(application, hackathon);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending hackathon email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/program-applications/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const application = await db.collection('program_applications').findOne({ _id: new ObjectId(id) });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        let programTitle = "Program";
        let whatsappLink = "";
        let programId = application.trainingId || application.internshipId;

        if (programId) {
            const program = await db.collection('programs').findOne({ _id: new ObjectId(programId) });
            if (program) {
                programTitle = program.title;
                whatsappLink = program.whatsappGroupLink;
            }
        }

        await sendProgramApplicationEmail(application, programTitle, whatsappLink, application.programType);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending program email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/technology-applications/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const application = await db.collection('technology_applications').findOne({ _id: new ObjectId(id) });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        await sendTechApplicationEmail(application);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending technology email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/staffing-applications/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const application = await db.collection('staffing_applications').findOne({ _id: new ObjectId(id) });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        await sendStaffingApplicationEmail(application);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending staffing email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/marketing-applications/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const application = await db.collection('marketing_applications').findOne({ _id: new ObjectId(id) });
        if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

        await sendMarketingApplicationEmail(application);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending marketing email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// --- MARKETING APPLICATIONS ---
app.post('/api/marketing-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applicationData = {
            ...req.body, // Expects { clientDetails: {...}, digitalMarketingRequirements: {...} }
            submittedAt: new Date(),
            status: 'New'
        };
        const result = await db.collection('marketing_applications').insertOne(applicationData);

        // Send Email
        await sendMarketingApplicationEmail(req.body).catch(console.error);

        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting marketing application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/marketing-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('marketing_applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching marketing applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- DELETE ENDPOINTS FOR ADMIN PANEL ---

const createDeleteEndpoint = (collectionName, routeName) => {
    app.delete(`/ api / ${routeName}/:id`, async (req, res) => {
        try {
            if (!db) return res.status(500).json({ success: false, message: 'Database error' });
            const { id } = req.params;
            const result = await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });
            if (result.deletedCount === 1) {
                res.status(200).json({ success: true, message: 'Deleted successfully' });
            } else {
                res.status(404).json({ success: false, message: 'Not found' });
            }
        } catch (error) {
            console.error(`Error deleting from ${collectionName}:`, error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
};

createDeleteEndpoint('contacts', 'contacts');
createDeleteEndpoint('applications', 'applications'); // Hackathon apps
createDeleteEndpoint('program_applications', 'program-applications');
createDeleteEndpoint('technology_applications', 'technology-applications');
createDeleteEndpoint('staffing_applications', 'staffing-applications');
createDeleteEndpoint('marketing_applications', 'marketing-applications');

app.post('/api/contacts/:id/resend-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const contact = await db.collection('contacts').findOne({ _id: new ObjectId(id) });
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        await sendContactWelcomeEmail(contact);
        res.status(200).json({ success: true, message: 'Email resent successfully' });
    } catch (error) {
        console.error('Error resending contact email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- ADMIN EMAIL ENDPOINT ---
// --- ADMIN EMAIL ENDPOINT ---
app.post('/api/admin/send-email', async (req, res) => {
    const requestId = Date.now(); // Simple ID to track this request
    console.log(`[API][${requestId}] POST /api/admin/send-email hit.`);
    console.log(`[API][${requestId}] Request Body:`, JSON.stringify(req.body, null, 2));

    try {
        const { to, subject, body, links } = req.body;

        if (!to || !subject || !body) {
            console.error(`[API][${requestId}] Missing required fields. to=${to}, subject=${subject}, bodyLength=${body ? body.length : 0}`);
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Construct HTML content
        let linksHtml = '';
        if (links && links.length > 0) {
            linksHtml = `
            <div style="margin-top: 20px; padding: 15px; background-color: #f3f4f6; border-radius: 8px;">
                <p style="margin: 0 0 10px; font-weight: bold;">Useful Links:</p>
                <ul style="margin: 0; padding-left: 20px;">
                    ${links.map(link => `<li><a href="${link.url}" style="color: #2563eb;">${link.label || link.url}</a></li>`).join('')}
                </ul>
            </div>`;
        }

        const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6; color: #333;">
            <div style="padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                <h2 style="color: #2563eb; margin-top: 0;">NexByte Update</h2>
                <div style="white-space: pre-wrap;">${body}</div>
                ${linksHtml}
                <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="font-size: 12px; color: #6b7280; text-align: center;">Reference: Admin Communication</p>
                <p style="font-size: 12px; color: #6b7280; text-align: center;">&copy; ${new Date().getFullYear()} NexByte Services</p>
            </div>
        </div>`;

        console.log(`[API][${requestId}] Calling sendEmail...`);
        await sendEmail(to, subject, htmlContent);
        console.log(`[API][${requestId}] Email sent successfully.`);
        res.status(200).json({ success: true, message: 'Email sent successfully' });
    } catch (error) {
        console.error(`[API][${requestId}] Error in /api/admin/send-email:`, error);
        res.status(500).json({ success: false, message: 'Failed to send email' });
    }
});


// --- TESTIMONIALS & CASE STUDIES ---
app.get('/api/testimonials', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const items = await db.collection('testimonials').find({}).sort({ order: 1, createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: items });
    } catch (error) {
        console.error('Error fetching testimonials:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/testimonials', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const newItem = {
            ...req.body,
            ...req.body,
            createdAt: new Date(),
            isActive: false // Default to hidden
        };
        const result = await db.collection('testimonials').insertOne(newItem);
        res.status(201).json({ success: true, message: 'Item created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating testimonial:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/testimonials/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const result = await db.collection('testimonials').deleteOne({ _id: new ObjectId(req.params.id) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Item not found' });
        res.status(200).json({ success: true, message: 'Item deleted' });
    } catch (error) {
        console.error('Error deleting testimonial:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/testimonials/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { _id, isActive, ...updateData } = req.body; // Remove _id and isActive from update data
        const result = await db.collection('testimonials').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { ...updateData, isActive: false } } // Force hidden on update
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Item not found' });
        res.status(200).json({ success: true, message: 'Item updated' });
    } catch (error) {
        console.error('Error updating testimonial:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/testimonials/:id/status', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const result = await db.collection('testimonials').updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { isActive: req.body.isActive } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Item not found' });
        res.status(200).json({ success: true, message: 'Status updated' });
    } catch (error) {
        console.error('Error updating testimonial status:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/', (req, res) => {
    res.send('Backend is running');
});

// --- TRAININGS ---

app.post('/api/trainings', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const training = {
            ...req.body,
            createdAt: new Date(),
            status: req.body.status || 'Active',
            isHidden: true // Default to hidden
        };
        const result = await db.collection('trainings').insertOne(training);
        res.status(201).json({ success: true, message: 'Training created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating training:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/trainings', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const query = {};
        if (req.query.status) query.status = req.query.status;
        if (req.query.category) query.category = req.query.category;

        const trainings = await db.collection('trainings').find(query).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: trainings });
    } catch (error) {
        console.error('Error fetching trainings:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/trainings/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('trainings').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Training not found' });
        } else {
            res.status(200).json({ success: true, message: 'Visibility updated' });
        }
    } catch (error) {
        console.error('Error updating training visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/trainings/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        // Destructure known fields to ensure we don't accidentally wipe others if using $set with ...rest, 
        // but here we want to update specific fields including the new ones.
        const {
            name, category, topics, duration, mode, description, syllabusLink, status, formFields, startDate, endDate, applyBy,
            emailSubject, emailBody, emailLinks, timing, note, hiddenFields, communityLink // NEW FIELDS
        } = req.body;

        await db.collection('trainings').updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    name, category, topics, duration, mode, description, syllabusLink, status, formFields, startDate, endDate, applyBy,
                    emailSubject, emailBody, emailLinks, timing, note, hiddenFields, communityLink, // NEW FIELDS
                    isHidden: true // Force hidden on update
                }
            }
        );
        res.status(200).json({ success: true, message: 'Training updated successfully' });
    } catch (error) {
        console.error('Error updating training:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/trainings/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        await db.collection('trainings').deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true, message: 'Training deleted' });
    } catch (error) {
        console.error('Error deleting training:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- TRAINING APPLICATIONS ---

async function sendCustomTrainingEmail(application, training) {
    const email = application.email;
    if (!email) return;

    // Use custom subject or default
    const subject = training.emailSubject || `Registration Confirmed: ${training.name} 🎓`;

    // Build Custom Body
    // Replace simple placeholders if we want to support them, e.g., {{name}}
    let bodyContent = training.emailBody || `Thank you for registering for <strong>${training.name}</strong> at NexByte! We are excited to have you on board to upgrade your skills.`;

    // Simple replacement for name
    bodyContent = bodyContent.replace(/{{name}}/g, application.applicantName || 'Learner');
    bodyContent = bodyContent.replace(/\n/g, '<br>'); // Simple newline to break conversion

    // Build Links Section
    let linksHtml = '';
    if (training.emailLinks && Array.isArray(training.emailLinks) && training.emailLinks.length > 0) {
        linksHtml = `
        <div style="margin-top: 25px; text-align: center;">
            <p style="margin-bottom: 15px; font-weight: bold; color: #475569;">Quick Links:</p>
            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                ${training.emailLinks.map(link => `
                    <a href="${link.url}" style="
                        display: inline-block; 
                        padding: 10px 20px; 
                        background-color: ${link.isButton ? '#6366f1' : 'transparent'}; 
                        color: ${link.isButton ? '#ffffff' : '#6366f1'}; 
                        border: ${link.isButton ? 'none' : '1px solid #6366f1'};
                        text-decoration: none; 
                        border-radius: 6px; 
                        font-weight: 600;
                        font-size: 14px;
                        margin: 5px;
                    ">${link.label}</a>
                `).join('')}
            </div>
        </div>`;
    }

    const educationHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0; }
            .header h1 { color: white; margin: 0; font-size: 24px; }
            .content { background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px; }
            .greeting { font-size: 18px; color: #1e293b; margin-bottom: 20px; }
            .message { color: #475569; margin-bottom: 25px; }
            .details-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>${training.emailSubject ? 'Update from NexByte' : 'Registration Confirmed! 🎓'}</h1>
        </div>
        <div class="content">
            <h2 class="greeting">Hello ${application.applicantName || 'Learner'},</h2>
            
            <div class="message">
                ${bodyContent}
            </div>

            ${linksHtml}

            <div class="details-box">
                <p><strong>Training:</strong> ${training.name}</p>
                <p><strong>Mode:</strong> ${training.mode || 'Online / Hybrid'}</p>
                ${training.timing ? `<p><strong>Timing:</strong> ${training.timing}</p>` : ''}
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="https://www.nexbyteind.com" style="color: #64748b; text-decoration: none; font-size: 12px;">Visit Website</a>
            </div>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} NexByte. All rights reserved.</p>
        </div>
    </body>
    </html>
    `;

    await sendEmail(email, subject, educationHtml);
}

app.post('/api/apply-training', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const { trainingName, applicantName, email, trainingId, ...otherData } = req.body;

        if (!applicantName || !email || !trainingName) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        const application = {
            trainingName,
            trainingId,
            applicantName,
            email,
            dynamicData: otherData,
            status: 'New',
            submittedAt: new Date()
        };

        const result = await db.collection('training_applications').insertOne(application);

        // Fetch training to get custom email config
        let training = null;
        if (trainingId) {
            training = await db.collection('trainings').findOne({ _id: new ObjectId(trainingId) });
        } else {
            // Fallback lookup by name if ID not sent (legacy support)
            training = await db.collection('trainings').findOne({ name: trainingName });
        }

        if (training) {
            await sendCustomTrainingEmail(application, training);
        } else {
            // Fallback to generic if training not found (shouldn't happen often)
            await sendTrainingApplicationEmail(application, trainingName);
        }

        // Send Admin Notification (Reuse existing logic or copy here)
        const adminHtml = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <h2 style="color: #6366f1;">New Training Application 🚀</h2>
                <div style="background: #fff; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0;">
                    <p><strong>Training:</strong> ${trainingName}</p>
                    <p><strong>Applicant:</strong> ${applicantName}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    ${training && training.timing ? `<p><strong>Timing:</strong> ${training.timing}</p>` : ''}
                    
                    <h4 style="border-bottom: 2px solid #6366f1; padding-bottom: 5px; margin-top: 20px;">Submission Details:</h4>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        ${Object.entries(otherData || {}).map(([key, value]) => `
                            <tr>
                                <td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; width: 40%;">${key}</td>
                                <td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                <p style="margin-top: 20px; font-size: 12px; color: #64748b;">Sent via NexByte Admin System</p>
            </div>
        </body>
        </html>
        `;
        await sendEmail(process.env.BREVO_SENDER_EMAIL || process.env.SMTP_EMAIL, `New Applicant: ${trainingName}`, adminHtml);


        res.status(201).json({ success: true, message: 'Application submitted', id: result.insertedId });
    } catch (error) {
        console.error('Error submitting training application:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/training-applications', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const applications = await db.collection('training_applications').find({}).sort({ submittedAt: -1 }).toArray();
        res.status(200).json({ success: true, data: applications });
    } catch (error) {
        console.error('Error fetching training applications:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- SOCIAL POSTS (LinkedIn Style) ---

// ImageKit Authentication Endpoint
app.get('/api/imagekit-auth', function (req, res) {
    var result = imagekit.getAuthenticationParameters();
    res.send(result);
});

// Create Social Post
app.post('/api/social-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const postData = {
            ...req.body,
            likes: 0,
            shares: 0,
            comments: [],
            createdAt: new Date(),
            shares: 0,
            comments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            isHidden: true // Default to hidden
        };

        const result = await db.collection('social_posts').insertOne(postData);
        res.status(201).json({ success: true, message: 'Post created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating social post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- CATEGORIES ---
app.post('/api/categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

        // Check if category exists
        const existing = await db.collection('categories').findOne({ name });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Category already exists' });
        }

        const category = {
            name,
            isHidden: false,
            createdAt: new Date()
        };
        const result = await db.collection('categories').insertOne(category);
        res.status(201).json({ success: true, message: 'Category created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const query = {};
        // If not explicitly asking for hidden categories (e.g. Admin), filter them out.
        if (req.query.includeHidden !== 'true') {
            query.isHidden = { $ne: true };
        }

        const categories = await db.collection('categories').find(query).sort({ name: 1 }).toArray();
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/categories/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('categories').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Category deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found' });
        }
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/categories/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('categories').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: 'Category visibility updated' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found or unchanged' });
        }
    } catch (error) {
        console.error('Error updating category visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


// Get Public Social Posts (Filters out hidden)
app.get('/api/social-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : req.query.sort === 'general'
                ? { createdAt: 1 } // Oldest first
                : { createdAt: -1 }; // Latest (Newest first) - Default

        const query = { isHidden: { $ne: true } };

        // 1. Get Hidden Categories
        const hiddenCategories = await db.collection('categories').find({ isHidden: true }).toArray();
        const hiddenCategoryNames = hiddenCategories.map(c => c.name);

        if (hiddenCategoryNames.length > 0) {
            // Exclude posts that belong to hidden categories
            query.category = { $nin: hiddenCategoryNames };
        }

        // 2. Add Category Filter (Specific Category selected by user)
        if (req.query.category && req.query.category !== 'All') {
            // If the selected category is itself hidden, we should technically return nothing or let the exclusion handle it.
            // But if user manually requests a category, we overwrite the $nin if it conflicts? 
            // Better to keep the restriction: even if asked, don't show if hidden.
            // Using $and or implicit AND.
            // If query.category is already set by $nin, we need to be careful.
            // MongoDB allows implicit specific value match overriding, but to be safe with $nin AND specific match:
            if (hiddenCategoryNames.includes(req.query.category)) {
                // User asked for a hidden category explicitly -> return empty immediately
                return res.status(200).json({ success: true, data: [] });
            }
            query.category = req.query.category;
        }

        // 3. Date Filter
        if (req.query.date) {
            const filterDate = new Date(req.query.date);
            if (!isNaN(filterDate)) {
                const nextDay = new Date(filterDate);
                nextDay.setDate(nextDay.getDate() + 1);

                query.createdAt = {
                    $gte: filterDate,
                    $lt: nextDay
                };
            }
        }

        // Sort by option, exclude hidden posts
        const posts = await db.collection('social_posts')
            .find(query)
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching social posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Get All Social Posts (Includes hidden)
app.get('/api/admin/social-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : { createdAt: -1 };

        const posts = await db.collection('social_posts')
            .find({})
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching admin social posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Single Social Post
app.get('/api/social-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const post = await db.collection('social_posts').findOne({ _id: new ObjectId(id) });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, data: post });
    } catch (error) {
        console.error('Error fetching social post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update Social Post (Likes, Shares, Comments, or Edit Content)
app.put('/api/social-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { type, payload } = req.body; // type: 'like', 'share', 'comment', 'edit'

        let updateOp = {};

        if (type === 'like') {
            updateOp = { $inc: { likes: 1 } };
        } else if (type === 'share') {
            updateOp = { $inc: { shares: 1 } };
        } else if (type === 'comment') {
            // payload should be { user: "Name", text: "comment", date: ... }
            updateOp = { $push: { comments: payload } };
        } else if (type === 'edit') {
            // payload is the full update object
            updateOp = { $set: { ...payload, updatedAt: new Date(), isHidden: true } }; // Force hidden on update
        } else if (type === 'visibility') {
            // payload: { isHidden: boolean }
            updateOp = { $set: { isHidden: payload.isHidden } };
        } else if (type === 'comments-toggle') {
            // payload: { commentsHidden: boolean }
            updateOp = { $set: { commentsHidden: payload.commentsHidden } };
        } else {
            return res.status(400).json({ success: false, message: 'Invalid update type' });
        }

        const result = await db.collection('social_posts').updateOne(
            { _id: new ObjectId(id) },
            updateOp
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Post not found' });
        } else {
            res.status(200).json({ success: true, message: 'Post updated' });
        }
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete Social Post
app.delete('/api/social-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const result = await db.collection('social_posts').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Post deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Post not found' });
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Export the Express API for Vercel

// --- SOCIAL POST VALIDATION (OTP & EMAILS) ---

    // (otpTransporter removed in favor of global Brevo transporter)

// Admin: Get all allowed emails
app.get('/api/admin/social-post-emails', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const emails = await db.collection('social_post_validation_emails').find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: emails });
    } catch (error) {
        console.error('Error fetching emails:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Add new email
app.post('/api/admin/social-post-emails', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const existing = await db.collection('social_post_validation_emails').findOne({ email: email.toLowerCase() });
        if (existing) return res.status(400).json({ success: false, message: 'Email already exists' });

        const result = await db.collection('social_post_validation_emails').insertOne({
            email: email.toLowerCase(),
            createdAt: new Date()
        });
        res.status(201).json({ success: true, data: { _id: result.insertedId, email: email.toLowerCase() } });
    } catch (error) {
        console.error('Error adding email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Edit email
app.put('/api/admin/social-post-emails/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const result = await db.collection('social_post_validation_emails').updateOne(
            { _id: new ObjectId(id) },
            { $set: { email: email.toLowerCase(), updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Email not found' });
        res.status(200).json({ success: true, message: 'Email updated' });
    } catch (error) {
        console.error('Error updating email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Delete email
app.delete('/api/admin/social-post-emails/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('social_post_validation_emails').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Email not found' });
        res.status(200).json({ success: true, message: 'Email deleted' });
    } catch (error) {
        console.error('Error deleting email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Frontend: Verify Email and Send OTP
app.post('/api/social-posts/verify-email', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

        const allowed = await db.collection('social_post_validation_emails').findOne({ email: email.toLowerCase() });
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Email not found in database. Please contact helpdesk from footer part.' });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store OTP with expiry (1 minute)
        const expiresAt = new Date(Date.now() + 60 * 1000);
        await db.collection('otp_verifications').updateOne(
            { email: email.toLowerCase() },
            { $set: { otp, expiresAt, createdAt: new Date() } },
            { upsert: true }
        );

        // Send OTP via Email using the global Brevo transporter
        const htmlContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #2563eb;">Verification OTP</h2>
                <p>Hello,</p>
                <p>Your one-time password (OTP) for accessing Social Posts is:</p>
                <h1 style="font-size: 36px; letter-spacing: 5px; color: #1e40af; text-align: center; background: #f3f4f6; padding: 10px; border-radius: 8px;">${otp}</h1>
                <p>This OTP is valid for <strong>1 minute</strong>.</p>
                <p>If you did not request this, please ignore this email.</p>
                <br/>
                <p>Best Regards,<br/><strong>Team NexByte</strong></p>
            </div>
        `;

        await sendEmail(email, 'Your Social Posts Verification OTP', htmlContent);

        res.status(200).json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Error in verify-email:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Frontend: Validate OTP
app.post('/api/social-posts/validate-otp', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ success: false, message: 'Email and OTP are required' });

        const record = await db.collection('otp_verifications').findOne({ email: email.toLowerCase() });
        if (!record) {
            return res.status(400).json({ success: false, message: 'No OTP request found for this email' });
        }

        if (new Date() > new Date(record.expiresAt)) {
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }

        if (record.otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        // OTP is valid, remove it
        await db.collection('otp_verifications').deleteOne({ email: email.toLowerCase() });

        res.status(200).json({ success: true, message: 'OTP verified successfully' });
    } catch (error) {
        console.error('Error in validate-otp:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- AI POSTS ---

// Create AI Post
app.post('/api/ai-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const postData = {
            ...req.body,
            likes: 0,
            shares: 0,
            comments: [],
            createdAt: new Date(),
            shares: 0,
            comments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            isHidden: true // Default to hidden
        };

        const result = await db.collection('ai_posts').insertOne(postData);
        res.status(201).json({ success: true, message: 'Post created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating ai post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- AI CATEGORIES ---
app.post('/api/ai-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

        const existing = await db.collection('ai_categories').findOne({ name });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Category already exists' });
        }

        const category = {
            name,
            isHidden: false,
            createdAt: new Date()
        };
        const result = await db.collection('ai_categories').insertOne(category);
        res.status(201).json({ success: true, message: 'Category created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating ai category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/ai-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const query = {};
        if (req.query.includeHidden !== 'true') {
            query.isHidden = { $ne: true };
        }

        const categories = await db.collection('ai_categories').find(query).sort({ name: 1 }).toArray();
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching ai categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/ai-categories/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('ai_categories').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Category deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found' });
        }
    } catch (error) {
        console.error('Error deleting ai category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/ai-categories/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('ai_categories').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: 'Category visibility updated' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found or unchanged' });
        }
    } catch (error) {
        console.error('Error updating ai category visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Public AI Posts (Filters out hidden)
app.get('/api/ai-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : req.query.sort === 'general'
                ? { createdAt: 1 }
                : { createdAt: -1 };

        const query = { isHidden: { $ne: true } };

        const hiddenCategories = await db.collection('ai_categories').find({ isHidden: true }).toArray();
        const hiddenCategoryNames = hiddenCategories.map(c => c.name);

        if (hiddenCategoryNames.length > 0) {
            query.category = { $nin: hiddenCategoryNames };
        }

        if (req.query.category && req.query.category !== 'All') {
            if (hiddenCategoryNames.includes(req.query.category)) {
                return res.status(200).json({ success: true, data: [] });
            }
            query.category = req.query.category;
        }

        if (req.query.date) {
            const filterDate = new Date(req.query.date);
            if (!isNaN(filterDate)) {
                const nextDay = new Date(filterDate);
                nextDay.setDate(nextDay.getDate() + 1);
                query.createdAt = {
                    $gte: filterDate,
                    $lt: nextDay
                };
            }
        }

        const posts = await db.collection('ai_posts')
            .find(query)
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching ai posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Get All AI Posts (Includes hidden)
app.get('/api/admin/ai-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : { createdAt: -1 };

        const posts = await db.collection('ai_posts')
            .find({})
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching admin ai posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Single AI Post
app.get('/api/ai-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const post = await db.collection('ai_posts').findOne({ _id: new ObjectId(id) });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, data: post });
    } catch (error) {
        console.error('Error fetching ai post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update AI Post
app.put('/api/ai-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { type, payload } = req.body;

        let updateOp = {};

        if (type === 'like') {
            updateOp = { $inc: { likes: 1 } };
        } else if (type === 'share') {
            updateOp = { $inc: { shares: 1 } };
        } else if (type === 'comment') {
            updateOp = { $push: { comments: payload } };
        } else if (type === 'edit') {
            updateOp = { $set: { ...payload, updatedAt: new Date(), isHidden: true } }; // Force hidden on update
        } else if (type === 'visibility') {
            updateOp = { $set: { isHidden: payload.isHidden } };
        } else if (type === 'comments-toggle') {
            updateOp = { $set: { commentsHidden: payload.commentsHidden } };
        } else {
            return res.status(400).json({ success: false, message: 'Invalid update type' });
        }

        const result = await db.collection('ai_posts').updateOne(
            { _id: new ObjectId(id) },
            updateOp
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Post not found' });
        } else {
            res.status(200).json({ success: true, message: 'Post updated' });
        }
    } catch (error) {
        console.error('Error updating ai post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete AI Post
app.delete('/api/ai-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const result = await db.collection('ai_posts').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Post deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Post not found' });
        }
    } catch (error) {
        console.error('Error deleting ai post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- CSE CORE POSTS ---

// Create CSE Core Post
app.post('/api/cse-core-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const postData = {
            ...req.body,
            likes: 0,
            shares: 0,
            comments: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            isHidden: true // Default to hidden
        };

        const result = await db.collection('cse_core_posts').insertOne(postData);
        res.status(201).json({ success: true, message: 'Post created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating cse core post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- CSE CORE CATEGORIES ---
app.post('/api/cse-core-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

        const existing = await db.collection('cse_core_categories').findOne({ name });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Category already exists' });
        }

        const category = {
            name,
            isHidden: false,
            createdAt: new Date()
        };
        const result = await db.collection('cse_core_categories').insertOne(category);
        res.status(201).json({ success: true, message: 'Category created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating cse core category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/cse-core-categories', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const query = {};
        if (req.query.includeHidden !== 'true') {
            query.isHidden = { $ne: true };
        }

        const categories = await db.collection('cse_core_categories').find(query).sort({ name: 1 }).toArray();
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching cse core categories:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/cse-core-categories/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const result = await db.collection('cse_core_categories').deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Category deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found' });
        }
    } catch (error) {
        console.error('Error deleting cse core category:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/cse-core-categories/:id/visibility', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { isHidden } = req.body;

        const result = await db.collection('cse_core_categories').updateOne(
            { _id: new ObjectId(id) },
            { $set: { isHidden: isHidden } }
        );

        if (result.modifiedCount === 1) {
            res.status(200).json({ success: true, message: 'Category visibility updated' });
        } else {
            res.status(404).json({ success: false, message: 'Category not found or unchanged' });
        }
    } catch (error) {
        console.error('Error updating cse core category visibility:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Public CSE Core Posts (Filters out hidden)
app.get('/api/cse-core-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : req.query.sort === 'general'
                ? { createdAt: 1 }
                : { createdAt: -1 };

        const query = { isHidden: { $ne: true } };

        const hiddenCategories = await db.collection('cse_core_categories').find({ isHidden: true }).toArray();
        const hiddenCategoryNames = hiddenCategories.map(c => c.name);

        if (hiddenCategoryNames.length > 0) {
            query.category = { $nin: hiddenCategoryNames };
        }

        if (req.query.category && req.query.category !== 'All') {
            if (hiddenCategoryNames.includes(req.query.category)) {
                return res.status(200).json({ success: true, data: [] });
            }
            query.category = req.query.category;
        }

        if (req.query.date) {
            const filterDate = new Date(req.query.date);
            if (!isNaN(filterDate)) {
                const nextDay = new Date(filterDate);
                nextDay.setDate(nextDay.getDate() + 1);
                query.createdAt = {
                    $gte: filterDate,
                    $lt: nextDay
                };
            }
        }

        const posts = await db.collection('cse_core_posts')
            .find(query)
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching cse core posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin Get All CSE Core Posts (Includes hidden)
app.get('/api/admin/cse-core-posts', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });

        const sortOption = req.query.sort === 'popular'
            ? { likes: -1, shares: -1, createdAt: -1 }
            : { createdAt: -1 };

        const posts = await db.collection('cse_core_posts')
            .find({})
            .sort(sortOption)
            .toArray();
        res.status(200).json({ success: true, data: posts });
    } catch (error) {
        console.error('Error fetching admin cse core posts:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get Single CSE Core Post
app.get('/api/cse-core-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const post = await db.collection('cse_core_posts').findOne({ _id: new ObjectId(id) });

        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        res.status(200).json({ success: true, data: post });
    } catch (error) {
        console.error('Error fetching cse core post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Update CSE Core Post
app.put('/api/cse-core-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const { type, payload } = req.body;

        let updateOp = {};

        if (type === 'like') {
            updateOp = { $inc: { likes: 1 } };
        } else if (type === 'share') {
            updateOp = { $inc: { shares: 1 } };
        } else if (type === 'comment') {
            updateOp = { $push: { comments: payload } };
        } else if (type === 'edit') {
            updateOp = { $set: { ...payload, updatedAt: new Date(), isHidden: true } }; // Force hidden on update
        } else if (type === 'visibility') {
            updateOp = { $set: { isHidden: payload.isHidden } };
        } else if (type === 'comments-toggle') {
            updateOp = { $set: { commentsHidden: payload.commentsHidden } };
        } else {
            return res.status(400).json({ success: false, message: 'Invalid update type' });
        }

        const result = await db.collection('cse_core_posts').updateOne(
            { _id: new ObjectId(id) },
            updateOp
        );

        if (result.matchedCount === 0) {
            res.status(404).json({ success: false, message: 'Post not found' });
        } else {
            res.status(200).json({ success: true, message: 'Post updated' });
        }
    } catch (error) {
        console.error('Error updating cse core post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Delete CSE Core Post
app.delete('/api/cse-core-posts/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;

        const result = await db.collection('cse_core_posts').deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 1) {
            res.status(200).json({ success: true, message: 'Post deleted' });
        } else {
            res.status(404).json({ success: false, message: 'Post not found' });
        }
    } catch (error) {
        console.error('Error deleting cse core post:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- 404 Debug Handler ---

// --- TOOLS: NOTES ---
app.get('/api/notes', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const notes = await db.collection('notes').find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json({ success: true, data: notes });
    } catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const note = {
            title: req.body.title,
            description: req.body.description,
            reason: req.body.reason,
            important: req.body.important || false,
            links: req.body.links || [], // Array of { name, url } or just strings
            createdAt: new Date()
        };
        const result = await db.collection('notes').insertOne(note);
        res.status(201).json({ success: true, message: 'Note created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const updateData = { ...req.body };
        delete updateData._id; // Prevent updating _id

        const result = await db.collection('notes').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        res.status(200).json({ success: true, message: 'Note updated' });
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        await db.collection('notes').deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true, message: 'Note deleted' });
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// --- TOOLS: TODOS ---
app.get('/api/todos', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const todos = await db.collection('todos').find({}).toArray();
        res.status(200).json({ success: true, data: todos });
    } catch (error) {
        console.error('Error fetching todos:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/todos', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const todo = {
            title: req.body.title,
            description: req.body.description,
            priority: req.body.priority || 'Medium',
            status: req.body.status || 'Todo',
            createdAt: new Date()
        };
        const result = await db.collection('todos').insertOne(todo);
        res.status(201).json({ success: true, message: 'Todo created', id: result.insertedId });
    } catch (error) {
        console.error('Error creating todo:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/todos/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        const updateData = { ...req.body };
        delete updateData._id;

        const result = await db.collection('todos').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        res.status(200).json({ success: true, message: 'Todo updated' });
    } catch (error) {
        console.error('Error updating todo:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/todos/:id', async (req, res) => {
    try {
        if (!db) return res.status(500).json({ success: false, message: 'Database error' });
        const { id } = req.params;
        await db.collection('todos').deleteOne({ _id: new ObjectId(id) });
        res.status(200).json({ success: true, message: 'Todo deleted' });
    } catch (error) {
        console.error('Error deleting todo:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});


app.use((req, res, next) => {
    console.log(`[404] Route not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Export the Express API for Vercel
module.exports = app;

// Only listen if not running in a serverless environment (Vercel)
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
