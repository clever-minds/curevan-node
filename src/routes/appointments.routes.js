const express = require("express");
const router = express.Router();

const appointmentsController = require("../controllers/appointments/appointmentsController");
const authMiddleware = require("../middlewares/authMiddleware");
const { requireRole } = require("../middlewares/requireRole");
const responseHandler = require("../middlewares/responseHandler");

// ✅ GET all appointments
router.get("/", authMiddleware, requireRole("admin.ecom", "admin.therapy"), responseHandler,appointmentsController.listAppointments);

// ✅ GET appointments for user
router.get("/user/:userId/:role", authMiddleware,responseHandler, appointmentsController.listAppointmentsForUser);

// ✅ GET single appointment
// admin: list of PCRs (filters: bookingId, status, therapistId) - must stay above "/:id"
router.get("/pcr-list", authMiddleware, requireRole("admin.therapy"), responseHandler, appointmentsController.listPcrs);

router.get("/:id", authMiddleware,responseHandler, appointmentsController.getAppointmentById);

// ✅ POST create new booking request (Service-First Flow)
router.post("/request", authMiddleware, responseHandler, appointmentsController.createBookingRequest);

// ✅ GET available requests for therapists
router.get("/requests/available", authMiddleware, requireRole("therapist"), responseHandler, appointmentsController.getAvailableRequests);

// ✅ POST accept booking request
router.post("/accept/:id", authMiddleware, requireRole("therapist"), responseHandler, appointmentsController.acceptBookingRequest);

// ✅ POST reject booking request
router.post("/reject/:id", authMiddleware, requireRole("therapist"), responseHandler, appointmentsController.rejectBookingRequest);

// ✅ PUT update appointment status
router.put("/status/:id", authMiddleware, responseHandler, appointmentsController.updateAppointmentStatus);

// ✅ POST confirm payment
// admin only: records an OFFLINE payment (online payments use /api/payments/verify-booking)
router.post("/:id/pay", authMiddleware, requireRole("admin.therapy", "admin.ecom"), responseHandler, appointmentsController.confirmPayment);

// ✅ PATCH cancel appointment
router.patch("/:id/cancel", authMiddleware, responseHandler, appointmentsController.cancelAppointment);
router.post("/:id/cancel", authMiddleware, responseHandler, appointmentsController.cancelAppointment);

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

router.put("/reschedule/:id", authMiddleware, responseHandler, appointmentsController.rescheduleAppointment);

module.exports = router;