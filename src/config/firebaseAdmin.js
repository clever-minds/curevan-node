/**
 * Single Firebase Admin initialisation, shared by push notifications and
 * phone-login token verification. Credentials (first match wins):
 *   1. ../../firebase-service-account.json (git-ignored, local development)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH  (file outside the repo)
 *   3. FIREBASE_SERVICE_ACCOUNT       (service-account JSON as one line)
 *   4. application default credentials (GOOGLE_APPLICATION_CREDENTIALS)
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getMessaging } = require("firebase-admin/messaging");

function loadServiceAccount() {
  try {
    return require("../../firebase-service-account.json");
  } catch (e) {
    /* file not present - try the other sources */
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    return JSON.parse(fs.readFileSync(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH), "utf8"));
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  return null;
}

let ready = false;
try {
  if (getApps().length === 0) {
    const serviceAccount = loadServiceAccount();
    if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
    else initializeApp();
  }
  ready = true;
} catch (error) {
  console.warn("Firebase Admin Initialization Warning:", error.message);
}

module.exports = { getAuth, getMessaging, isReady: () => ready };
