const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const dbName = process.env.DB_NAME || 'nexbyteind_db_user';
        const db = client.db(dbName);
        const hackathons = await db.collection('hackathons').find({}).toArray();
        console.log("ALL HACKATHONS/QUIZZES:");
        hackathons.forEach(h => {
            console.log(`- ID: ${h._id}, Name: ${h.name}, Type: ${h.type}, Status: ${h.status}, isHidden: ${h.isHidden}`);
        });
    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}
run();
