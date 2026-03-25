const express = require("express");
const router = express.Router();

const users = require("../controllers/users/usersController");
const responseHandler = require("../middlewares/responseHandler");
const authMiddleware = require("../middlewares/authMiddleware");


router.get("/list", authMiddleware,responseHandler, users.listUsers);
router.get("/list-team-management-users", authMiddleware,responseHandler, users.listTeamManagementUsers);
router.get("/profile-change-requests",authMiddleware,responseHandler,users.listChangeRequests);
router.get("/:id", authMiddleware,responseHandler, users.getUserById);
router.post("/add", authMiddleware,responseHandler, users.addUser);
router.put("/edit/:id", authMiddleware,responseHandler, users.updateUser);
router.delete("/delete/:id", authMiddleware,responseHandler, users.deleteUser);
router.post("/invite-admin", authMiddleware,responseHandler, users.inviteAdminUser);
router.post("/update-roles", authMiddleware,responseHandler, users.updateUserRoles);
//router.put("/change-request/approve-thearipst/:id",authMiddleware,responseHandler,users.approveThearipstChangeRequest);

router.put("/change-request/approve/:id",authMiddleware,responseHandler,users.approveChangeRequest);
router.put("/change-request/reject/:id",authMiddleware,responseHandler,users.rejectChangeRequest);
router.get("/change-request/:id", authMiddleware,responseHandler,users.getChangeRequestById);


//router.get("/frontend/list", responseHandler, users.getUsersFrontend);


module.exports = router;
