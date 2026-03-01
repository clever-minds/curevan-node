const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema(
  {
    uid: {
      type: String,
      required: true,
      unique: true,
      index: true
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      index: true
    },

    // 🔐 HASHED PASSWORD
    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false   // by default response me nahi aayega
    },

    name: {
      type: String,
      required: true
    },

    phone: {
      type: String
    },

    role: {
      type: String,
      enum: ["admin", "ecom-admin", "therapy-admin", "therapist","patient"],
      default: "patient"
    },

    roles: {
      type: [String],
      default: []
    }
  },
  {
    timestamps: true
  }
);

//
// 🔐 PASSWORD HASH BEFORE SAVE
//
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

//
// 🔐 PASSWORD COMPARE METHOD (LOGIN ke liye)
//
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
