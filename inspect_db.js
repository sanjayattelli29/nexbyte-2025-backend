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

const { MongoClient } = require('mongodb');
require('dotenv').config();

async function run() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const dbName = process.env.DB_NAME || 'nexbyteind_db_user';
        const db = client.db(dbName);
        console.log("Updating completed events to isHidden: false...");
        const updateRes = await db.collection('hackathons').updateMany({ status: 'completed' }, { $set: { isHidden: false } });
        console.log(`Updated ${updateRes.modifiedCount} completed events.`);

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
