const express = require("express");
const router = express.Router();

const users = require("../controllers/users/usersController");
const responseHandler = require("../middlewares/responseHandler");
const authMiddleware = require("../middlewares/authMiddleware");


const { requireRole } = require("../middlewares/requireRole");
router.get("/list", authMiddleware, requireRole("admin.therapy", "admin.ecom"),responseHandler, users.listUsers);
router.get("/list-team-management-users", authMiddleware, requireRole(),responseHandler, users.listTeamManagementUsers);
router.get("/profile-change-requests",authMiddleware, requireRole("admin.therapy"),responseHandler,users.listChangeRequests);
router.get("/:id", authMiddleware,responseHandler, users.getUserById);
router.post("/add", authMiddleware, requireRole(),responseHandler, users.addUser);
router.put("/edit/:id", authMiddleware, requireRole(),responseHandler, users.updateUser);
router.delete("/delete/:id", authMiddleware, requireRole(),responseHandler, users.deleteUser);
router.post("/invite-admin", authMiddleware, requireRole(),responseHandler, users.inviteAdminUser);
router.post("/update-roles", authMiddleware, requireRole(),responseHandler, users.updateUserRoles);
//router.put("/change-request/approve-thearipst/:id",authMiddleware,responseHandler,users.approveThearipstChangeRequest);

router.put("/change-request/approve/:id",authMiddleware, requireRole("admin.therapy"),responseHandler,users.approveChangeRequest);
router.put("/change-request/reject/:id",authMiddleware, requireRole("admin.therapy"),responseHandler,users.rejectChangeRequest);
router.get("/change-request/:id", authMiddleware, requireRole("admin.therapy"),responseHandler,users.getChangeRequestById);


//router.get("/frontend/list", responseHandler, users.getUsersFrontend);


module.exports = router;
