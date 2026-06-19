const { initializeApp, cert } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

// Note: You must provide a valid service account JSON to initialize Firebase Admin.
// For now, this handles the initialization safely if no credentials are provided yet.
try {
  let serviceAccount;
  try {
    serviceAccount = require("../../firebase-service-account.json");
  } catch (err) {
    // Ignore error if file doesn't exist locally
  }

  // If service account JSON is available locally, use it
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount)
    });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
      credential: cert(serviceAccount)
    });
  } else {
    // Attempt default initialization if credentials are in the environment (e.g. GOOGLE_APPLICATION_CREDENTIALS)
    initializeApp();
  }
} catch (error) {
  console.warn("Firebase Admin Initialization Warning:", error.message);
}

/**
 * Sends a targeted notification to a specific therapist.
 * @param {string} token - The FCM device token for the therapist.
 * @param {string} title - The notification title.
 * @param {string} body - The notification body.
 * @param {object} data - Optional data payload.
 */
exports.sendToTherapist = async (token, title, body, data = {}) => {
  if (!token) return;

  const message = {
    notification: { title, body },
    data,
    token
  };

  try {
    const response = await getMessaging().send(message);
    console.log("Successfully sent notification to therapist:", response);
  } catch (error) {
    console.error("Error sending notification to therapist:", error);
  }
};

/**
 * Sends a multicast notification to all available therapists.
 * Assuming therapists subscribe to a topic like "all_therapists" or we pass an array of tokens.
 * @param {string} title - The notification title.
 * @param {string} body - The notification body.
 * @param {object} data - Optional data payload.
 * @param {string} topic - The topic to send to (default: "all_therapists").
 */
exports.sendToAllTherapists = async (title, body, data = {}, topic = "all_therapists") => {
  const message = {
    notification: { title, body },
    data,
    topic
  };

  try {
    const response = await getMessaging().send(message);
    console.log("Successfully sent notification to all therapists:", response);
  } catch (error) {
    console.error("Error sending notification to all therapists:", error);
  }
};
