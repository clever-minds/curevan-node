const express = require("express");
const router = express.Router();

const users = require("../controllers/users/usersController");
const responseHandler = require("../middlewares/responseHandler");
const authMiddleware = require("../middlewares/authMiddleware");


router.get("/list", authMiddleware,responseHandler, users.listUsers);
router.get("/:id", authMiddleware,responseHandler, users.getUserById);
router.post("/add", authMiddleware,responseHandler, users.addUser);
router.put("/edit/:id", authMiddleware,responseHandler, users.updateUser);
router.delete("/delete/:id", authMiddleware,responseHandler, users.deleteUser);
//router.get("/frontend/list", responseHandler, users.getUsersFrontend);


module.exports = router;
