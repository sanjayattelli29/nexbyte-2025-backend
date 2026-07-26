const { ObjectId } = require('mongodb');

module.exports = function (app, connectDB) {
    // --- QUIZZES ---
    app.post('/api/quizzes', async (req, res) => {
        try {
            const db = await connectDB();
            const quizData = {
                name: req.body.name,
                bannerImage: req.body.bannerImage,
                companyName: req.body.companyName,
                companyLink: req.body.companyLink,
                isTimed: req.body.isTimed,
                durationMinutes: parseInt(req.body.durationMinutes) || 0,
                questions: req.body.questions || [], // Array of { question, options: [string], correctAnswer: string }
                createdAt: new Date()
            };

            const result = await db.collection('quizzes').insertOne(quizData);
            res.status(201).json({ success: true, message: 'Quiz created', id: result.insertedId });
        } catch (error) {
            console.error('Error creating quiz:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.get('/api/quizzes', async (req, res) => {
        try {
            const db = await connectDB();
            const quizzes = await db.collection('quizzes').find({}).sort({ createdAt: -1 }).toArray();
            res.status(200).json({ success: true, data: quizzes });
        } catch (error) {
            console.error('Error fetching quizzes:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.get('/api/quizzes/:id', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const quiz = await db.collection('quizzes').findOne({ _id: new ObjectId(id) });
            if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

            // Attach quizStartTime from linked hackathon if present
            if (!quiz.quizStartTime) {
                const linkedHackathon = await db.collection('hackathons').findOne({ linkedQuizId: id });
                if (linkedHackathon && linkedHackathon.quizStartTime) {
                    quiz.quizStartTime = linkedHackathon.quizStartTime;
                }
            }

            res.status(200).json({ success: true, data: quiz });
        } catch (error) {
            console.error('Error fetching quiz:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.put('/api/quizzes/:id', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const updateData = {
                name: req.body.name,
                bannerImage: req.body.bannerImage,
                companyName: req.body.companyName,
                companyLink: req.body.companyLink,
                isTimed: req.body.isTimed,
                durationMinutes: parseInt(req.body.durationMinutes) || 0,
                questions: req.body.questions || [],
                updatedAt: new Date()
            };

            const result = await db.collection('quizzes').updateOne(
                { _id: new ObjectId(id) },
                { $set: updateData }
            );

            if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Quiz not found' });
            res.status(200).json({ success: true, message: 'Quiz updated' });
        } catch (error) {
            console.error('Error updating quiz:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.put('/api/quizzes/:id/complete', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const { winner, secondWinner, raffleWinners } = req.body;

            const participantsCount = await db.collection('quiz_attempts').countDocuments({ quizId: id });

            const quizUpdateData = {
                status: 'completed',
                winner: winner || '',
                secondWinner: secondWinner || '',
                raffleWinners: raffleWinners || '',
                participantsCount,
                updatedAt: new Date()
            };

            const result = await db.collection('quizzes').updateOne(
                { _id: new ObjectId(id) },
                { $set: quizUpdateData }
            );

            if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Quiz not found' });

            // Automatically complete the linked hackathon wrapper if it exists
            await db.collection('hackathons').updateOne(
                { linkedQuizId: id },
                { $set: {
                    status: 'completed',
                    winner: winner || '',
                    secondWinner: secondWinner || '',
                    raffleWinners: raffleWinners || '',
                    participantsCount: participantsCount,
                    updatedAt: new Date()
                } }
            );

            res.status(200).json({ success: true, message: 'Quiz completed' });
        } catch (error) {
            console.error('Error completing quiz:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.delete('/api/quizzes/:id', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const result = await db.collection('quizzes').deleteOne({ _id: new ObjectId(id) });
            if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Quiz not found' });

            // Optionally delete related attempts here, or keep for records
            res.status(200).json({ success: true, message: 'Quiz deleted' });
        } catch (error) {
            console.error('Error deleting quiz:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    // --- QUIZ ATTEMPTS ---
    app.post('/api/quizzes/:id/attempts', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const attemptData = {
                quizId: id,
                email: req.body.email,
                mobile: req.body.mobile,
                correctCount: parseInt(req.body.correctCount) || 0,
                wrongCount: parseInt(req.body.wrongCount) || 0,
                totalTimeSeconds: parseInt(req.body.totalTimeSeconds) || 0,
                avgTimePerQuestion: parseFloat(req.body.avgTimePerQuestion) || 0,
                timePerQuestion: Array.isArray(req.body.timePerQuestion) ? req.body.timePerQuestion : [],
                submittedAt: new Date()
            };

            const result = await db.collection('quiz_attempts').insertOne(attemptData);
            res.status(201).json({ success: true, message: 'Attempt recorded', id: result.insertedId });
        } catch (error) {
            console.error('Error recording quiz attempt:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    app.get('/api/quizzes/:id/attempts', async (req, res) => {
        try {
            const db = await connectDB();
            const { id } = req.params;
            if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, message: 'Invalid ID' });

            const attempts = await db.collection('quiz_attempts').find({ quizId: id }).sort({ submittedAt: -1 }).toArray();
            res.status(200).json({ success: true, data: attempts });
        } catch (error) {
            console.error('Error fetching quiz attempts:', error);
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });
};
