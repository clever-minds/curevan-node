const axios = require("axios");

let token = null;
let tokenExpiry = null;

// ✅ 1. Get Shiprocket Token
async function getToken() {
  try {
    // 🔁 Reuse token if valid
    if (token && tokenExpiry && new Date() < tokenExpiry) {
      return token;
    }

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/auth/login",
      {
        email: process.env.SHIPROCKET_API_EMAIL,
        password: process.env.SHIPROCKET_API_PASSWORD,
      }
    );

    token = res.data.token;

    // ⏳ Token expiry (Shiprocket ~10 days, we keep 9 days safe)
    tokenExpiry = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);

    console.log("✅ Shiprocket Token Generated");

    return token;
  } catch (error) {
    console.error(
      "❌ Shiprocket Auth Error:",
      error.response?.data || error.message
    );
    throw new Error("Shiprocket authentication failed");
  }
}

// ✅ 2. Create Order in Shiprocket
async function createOrder(order) {
  try {
    const token = await getToken();

console.log("shiprocketPayload payload",token);
    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/orders/create/adhoc",
      order,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ Shiprocket Order Created");

    return res.data;
  } catch (error) {
    console.error(
      "❌ Shiprocket Order Error:",
      error.response?.data || error.message
    );
    throw new Error("Shiprocket order creation failed");
  }
}

// ✅ 3. Generate AWB
async function generateAWB(shipmentId) {
  try {
    const token = await getToken();

    console.log("🚚 Generating AWB for Shipment ID:", shipmentId);
    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/courier/assign/awb",
      {
        shipment_id: shipmentId,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ AWB Generated");

    return res.data.response.data;
  } catch (error) {
    console.error(
      "❌ AWB Error:",
      error.response?.data || error.message
    );
    throw new Error("AWB generation failed");
  }
}

// ✅ 4. Generate Label
async function generateLabel(shipmentId) {
  try {
    const token = await getToken();

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/courier/generate/label",
      {
        shipment_id: [shipmentId],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error(
      "❌ Label Error:",
      error.response?.data || error.message
    );
    throw new Error("Label generation failed");
  }
}

// ✅ 5. Generate Manifest
async function generateManifest(shipmentId) {
  try {
    const token = await getToken();

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/manifests/generate",
      {
        shipment_id: [shipmentId],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error(
      "❌ Manifest Error:",
      error.response?.data || error.message
    );
    throw new Error("Manifest generation failed");
  }
}

// ✅ 6. Track Shipment
async function trackShipment(awb) {
  try {
    const token = await getToken();

    const res = await axios.get(
      `https://apiv2.shiprocket.in/v1/external/courier/track/awb/${awb}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error(
      "❌ Tracking Error:",
      error.response?.data || error.message
    );
    throw new Error("Tracking failed");
  }
}

// ✅ 7. Cancel Shipment
async function cancelShipment(shipmentId) {
  try {
    const token = await getToken();

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/orders/cancel",
      {
        ids: [shipmentId],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return res.data;
  } catch (error) {
    console.error(
      "❌ Cancel Error:",
      error.response?.data || error.message
    );
    throw new Error("Cancel shipment failed");
  }
}

// ✅ 8. Create Return Order (Reverse Shipment)
async function createReturnOrder(order) {
  try {
    const token = await getToken();

    const res = await axios.post(
      "https://apiv2.shiprocket.in/v1/external/orders/create/return",
      order,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log("✅ Shiprocket Return Order Created");

    return res.data;
  } catch (error) {
    console.error(
      "❌ Shiprocket Return Order Error:",
      error.response?.data || error.message
    );
    throw new Error("Shiprocket return order creation failed");
  }
}

// ✅ 9. Get Pickup Locations
async function getPickupLocations() {
  try {
    const token = await getToken();
    const res = await axios.get(
      "https://apiv2.shiprocket.in/v1/external/settings/get/pickup",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return res.data;
  } catch (error) {
    console.error("❌ Pickup Locations Error:", error.response?.data || error.message);
    throw new Error("Failed to fetch pickup locations");
  }
}

module.exports = {
  getToken,
  createOrder,
  generateAWB,
  generateLabel,
  generateManifest,
  trackShipment,
  cancelShipment,
  createReturnOrder,
  getPickupLocations,
};