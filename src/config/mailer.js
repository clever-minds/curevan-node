const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "ujjawalmehta156@gmail.com",
    pass: "opgpmxqgixrwvcjm"
  }
});

module.exports = transporter;