const transporter = require("../config/mailer");

exports.sendMail = async (to, subject, html) => {
  try {

    const info = await transporter.sendMail({
      from: '"Admin Panel" <yourgmail@gmail.com>',
      to: to,
      subject: subject,
      html: html
    });

    console.log("Mail sent:", info.messageId);

    return true;

  } catch (error) {

    console.error("Mail error:", error);
    return false;

  }
};