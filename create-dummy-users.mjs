import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Load .env variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });

try {
    // If GOOGLE_APPLICATION_CREDENTIALS is set in .env and the file exists, it will be used automatically.
    // Otherwise, we fallback to try using standard application default credentials.
    initializeApp();
    console.log('Firebase Admin initialized successfully.');
} catch (error) {
    console.error('Failed to initialize Firebase Admin. Please ensure GOOGLE_APPLICATION_CREDENTIALS is set correctly in your .env file or environment variables.', error);
    process.exit(1);
}

const db = getFirestore();
const auth = getAuth();

async function createDummyUser(email, role, name) {
    try {
        let userRecord;
        try {
            // Check if user already exists in Auth
            userRecord = await auth.getUserByEmail(email);
            console.log(`User ${email} already exists in Firebase Auth with UID: ${userRecord.uid}`);
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Create user in Auth
                userRecord = await auth.createUser({
                    email: email,
                    password: 'password123', // Dummy password
                    displayName: name,
                });
                console.log(`Created user ${email} in Firebase Auth with UID: ${userRecord.uid}`);
            } else {
                throw error;
            }
        }

        const uid = userRecord.uid;
        
        // Define the user profile structure based on src/lib/types.ts UserProfile
        const userData = {
            id: Date.now() + Math.floor(Math.random() * 1000), // Numeric ID if needed
            uid: uid,
            email: email,
            role: role,
            roles: [role],
            name: name,
            push_opt_in: true,
            email_opt_in: true,
            createdAt: new Date(),
        };

        // If it's a therapist, we might also want to add a therapist profile
        if (role === 'therapist') {
            const therapistData = {
                id: uid,
                user_id: userData.id,
                name: name,
                specialty: 'Physiotherapy, Nursing Care, Speech Therapy',
                registrationNo: 'REG123456',
                bankAccountNo: '1234567890',
                bankIfscCode: 'IFSC0001234',
                line1: 'Ashwamegh Nagar, Tandalja, Near Fire Brigade',
                city: 'Vadodara',
                state: 'Gujarat',
                pin: '390012',
                country: 'India',
                lat: 22.2882,
                lng: 73.1585,
                rating: 5,
                reviews: 0,
                image: '',
                experience_years: 5,
                bio: 'A dummy therapist profile.',
                qualifications: 'BPT',
                serviceTypes: ['1', '2', '4']
            };
            
            // Save to therapists collection
            await db.collection('therapists').doc(uid).set(therapistData, { merge: true });
            console.log(`Created/Updated therapist profile for ${email} in Firestore.`);
        }

        // Save to users collection
        const userDocRef = db.collection('users').doc(uid);
        await userDocRef.set(userData, { merge: true });

        console.log(`Successfully created/updated ${role} profile for ${email} in Firestore users collection.`);
    } catch (error) {
        console.error(`Error processing ${email}:`, error);
    }
}

async function run() {
    console.log('Starting dummy user creation...');
    
    // Create Therapist
    await createDummyUser('therapist@curevan.com', 'therapist', 'Dummy Therapist');
    
    // Create Patient (User)
    await createDummyUser('user@curevan.com', 'patient', 'Dummy Patient');
    
    console.log('Finished dummy user creation!');
    process.exit(0);
}

run();
