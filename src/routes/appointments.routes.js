const express = require("express");
const router = express.Router();

const appointmentsController = require("../controllers/appointments/appointmentsController");
const authMiddleware = require("../middlewares/authMiddleware");
const responseHandler = require("../middlewares/responseHandler");

// ✅ GET all appointments
router.get("/", authMiddleware, responseHandler,appointmentsController.listAppointments);

// ✅ GET appointments for user
router.get("/user/:userId/:role", authMiddleware,responseHandler, appointmentsController.listAppointmentsForUser);

// ✅ GET single appointment
router.get("/:id", authMiddleware,responseHandler, appointmentsController.getAppointmentById);

// ✅ POST create new booking request (Service-First Flow)
router.post("/request", authMiddleware, responseHandler, appointmentsController.createBookingRequest);

// ✅ GET available requests for therapists
router.get("/requests/available", authMiddleware, responseHandler, appointmentsController.getAvailableRequests);

// ✅ POST accept booking request
router.post("/accept/:id", authMiddleware, responseHandler, appointmentsController.acceptBookingRequest);

// ✅ PUT update appointment status
router.put("/status/:id", authMiddleware, responseHandler, appointmentsController.updateAppointmentStatus);

router.post("/create-appointment", authMiddleware,responseHandler, appointmentsController.createBookingAndInvoice);

// ✅ POST submit review
router.post("/:id/review", authMiddleware, responseHandler, appointmentsController.addReview);

router.get("/pcr/:appointmentId", authMiddleware,responseHandler, appointmentsController.getPCRByBookingId);
router.patch(
  "/pcr/:appointmentId",
  authMiddleware,
  responseHandler,
  appointmentsController.updatePcr
);

//router.get("/users/:userId/appointments", authMiddleware, appointmentsController.listAppointmentsForUser);
// ✅ POST add new appointment
//router.post("/add", authMiddleware, appointmentsController.addAppointment);

// ✅ PUT update appointment
//router.put("/update/:id", authMiddleware, appointmentsController.updateAppointment);

// ✅ DELETE appointment
//router.delete("/delete/:id", authMiddleware, appointmentsController.deleteAppointment);

module.exports = router;