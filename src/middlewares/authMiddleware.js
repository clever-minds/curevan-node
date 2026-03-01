const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  let token = null;

  // 1️⃣ Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  // 2️⃣ If not in header, check cookie
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ message: "Token missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, uid, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
