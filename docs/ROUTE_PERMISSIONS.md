# Route permissions

Generated from the live Express router stack (`src/routes/*.js`). `admin.super` always passes every `requireRole` check.
Ownership checks (a user may only see their own records) are added in P04; routes marked "any logged-in user" are not yet filtered by owner.

| Method | Path | Login required | Allowed roles | Route file |
|---|---|---|---|---|
| POST | `/api/auth/register` | no | public (no login) | auth.routes |
| POST | `/api/auth/login` | no | public (no login) | auth.routes |
| GET | `/api/auth/profile` | yes | any logged-in user | auth.routes |
| GET | `/api/auth/me` | yes | any logged-in user | auth.routes |
| POST | `/api/auth/logout` | no | public (no login) | auth.routes |
| POST | `/api/auth/login-with-mobile` | no | public (no login) | auth.routes |
| POST | `/api/auth/verify-email` | no | public (no login) | auth.routes |
| POST | `/api/auth/resend-verification` | no | public (no login) | auth.routes |
| POST | `/api/auth/change-password` | yes | any logged-in user | auth.routes |
| POST | `/api/auth/forgot-password` | no | public (no login) | auth.routes |
| POST | `/api/auth/reset-password` | no | public (no login) | auth.routes |
| PUT | `/api/auth/update-profile` | yes | any logged-in user | auth.routes |
| PUT | `/api/auth/update-fcm-token` | yes | any logged-in user | auth.routes |
| POST | `/api/auth/change-profile-request` | yes | any logged-in user | auth.routes |
| GET | `/api/auth/google` | no | public (no login) | auth.routes |
| GET | `/api/auth/google/callback` | no | public (no login) | auth.routes |
| GET | `/api/category/list` | yes | any logged-in user | category.routes |
| POST | `/api/category/add` | yes | admin.super, admin.ecom | category.routes |
| PUT | `/api/category/edit/:id` | yes | admin.super, admin.ecom | category.routes |
| DELETE | `/api/category/delete/:id` | yes | admin.super, admin.ecom | category.routes |
| GET | `/api/category/get-all` | no | public (no login) | category.routes |
| GET | `/api/subcategory/list` | yes | any logged-in user | subcategory.routes |
| GET | `/api/subcategory/category/:categoryId` | no | public (no login) | subcategory.routes |
| POST | `/api/subcategory/add` | yes | admin.super, admin.ecom | subcategory.routes |
| PUT | `/api/subcategory/edit/:id` | yes | admin.super, admin.ecom | subcategory.routes |
| DELETE | `/api/subcategory/delete/:id` | yes | admin.super, admin.ecom | subcategory.routes |
| GET | `/api/journal-categories/list` | no | public (no login) | journal_category.routes |
| POST | `/api/journal-categories/add` | yes | admin.super, admin.therapy, admin.ecom | journal_category.routes |
| PUT | `/api/journal-categories/edit/:id` | yes | admin.super, admin.therapy, admin.ecom | journal_category.routes |
| DELETE | `/api/journal-categories/delete/:id` | yes | admin.super, admin.therapy, admin.ecom | journal_category.routes |
| GET | `/api/journal-tags/list` | no | public (no login) | journal_tag.routes |
| POST | `/api/journal-tags/add` | yes | admin.super, admin.therapy, admin.ecom | journal_tag.routes |
| PUT | `/api/journal-tags/edit/:id` | yes | admin.super, admin.therapy, admin.ecom | journal_tag.routes |
| DELETE | `/api/journal-tags/delete/:id` | yes | admin.super, admin.therapy, admin.ecom | journal_tag.routes |
| GET | `/api/products/list` | yes | admin.super, admin.ecom | products.routes |
| GET | `/api/products/:id` | yes | any logged-in user | products.routes |
| GET | `/api/products/inventory/list` | yes | admin.super, admin.ecom | products.routes |
| GET | `/api/products/frontend/list` | no | public (no login) | products.routes |
| GET | `/api/products/frontend/recommended` | no | public (no login) | products.routes |
| GET | `/api/products/frontend/:id` | no | public (no login) | products.routes |
| POST | `/api/products/get-by-ids` | yes | any logged-in user | products.routes |
| POST | `/api/products/add` | yes | admin.super, admin.ecom | products.routes |
| PUT | `/api/products/edit/:id` | yes | admin.super, admin.ecom | products.routes |
| DELETE | `/api/products/delete/:id` | yes | admin.super, admin.ecom | products.routes |
| GET | `/api/media/list` | yes | admin.super, admin.ecom, admin.therapy, therapist | media.routes |
| POST | `/api/media/upload` | yes | admin.super, admin.ecom, admin.therapy, therapist | media.routes |
| DELETE | `/api/media/delete/:id` | yes | admin.super, admin.ecom, admin.therapy, therapist | media.routes |
| GET | `/api/media/url/:id` | no | public (no login) | media.routes |
| POST | `/api/coupons/add` | yes | admin.super, admin.ecom, admin.therapy | coupons.routes |
| GET | `/api/coupons/list` | yes | admin.super, admin.ecom, admin.therapy | coupons.routes |
| GET | `/api/coupons/get-all` | no | public (no login) | coupons.routes |
| GET | `/api/coupons/:id` | yes | admin.super, admin.ecom, admin.therapy | coupons.routes |
| PUT | `/api/coupons/edit/:id` | yes | admin.super, admin.ecom, admin.therapy | coupons.routes |
| DELETE | `/api/coupons/delete/:id` | yes | admin.super, admin.ecom, admin.therapy | coupons.routes |
| POST | `/api/coupons/apply` | yes | any logged-in user | coupons.routes |
| GET | `/api/cart/list` | yes | any logged-in user | cart.routes |
| POST | `/api/cart/add-or-update` | yes | any logged-in user | cart.routes |
| DELETE | `/api/cart/remove/:productId` | yes | any logged-in user | cart.routes |
| DELETE | `/api/cart/clear` | yes | any logged-in user | cart.routes |
| GET | `/api/addresses/list` | yes | any logged-in user | useraddress.route |
| GET | `/api/addresses/:addressId` | yes | any logged-in user | useraddress.route |
| POST | `/api/addresses/add` | yes | any logged-in user | useraddress.route |
| PUT | `/api/addresses/edit/:addressId` | yes | any logged-in user | useraddress.route |
| DELETE | `/api/addresses/delete/:addressId` | yes | any logged-in user | useraddress.route |
| GET | `/api/users/list` | yes | admin.super, admin.therapy, admin.ecom | user.routes |
| GET | `/api/users/list-team-management-users` | yes | admin.super | user.routes |
| GET | `/api/users/profile-change-requests` | yes | admin.super, admin.therapy | user.routes |
| GET | `/api/users/:id` | yes | any logged-in user | user.routes |
| POST | `/api/users/add` | yes | admin.super | user.routes |
| PUT | `/api/users/edit/:id` | yes | admin.super | user.routes |
| DELETE | `/api/users/delete/:id` | yes | admin.super | user.routes |
| POST | `/api/users/invite-admin` | yes | admin.super | user.routes |
| POST | `/api/users/update-roles` | yes | admin.super | user.routes |
| PUT | `/api/users/change-request/approve/:id` | yes | admin.super, admin.therapy | user.routes |
| PUT | `/api/users/change-request/reject/:id` | yes | admin.super, admin.therapy | user.routes |
| GET | `/api/users/change-request/:id` | yes | admin.super, admin.therapy | user.routes |
| GET | `/api/orders/my-orders` | yes | any logged-in user | order.routes |
| GET | `/api/orders/refunds` | yes | admin.super, admin.ecom | order.routes |
| GET | `/api/orders/my-refunds` | yes | any logged-in user | order.routes |
| POST | `/api/orders/refunds` | yes | admin.super, admin.ecom | order.routes |
| GET | `/api/orders/returns` | yes | admin.super, admin.ecom | order.routes |
| POST | `/api/orders/:id/return` | yes | any logged-in user | order.routes |
| PUT | `/api/orders/returns/:id/approve` | yes | admin.super, admin.ecom | order.routes |
| GET | `/api/orders/invoice/:id` | yes | any logged-in user | order.routes |
| GET | `/api/orders/order/:id` | yes | any logged-in user | order.routes |
| POST | `/api/orders/validate-cart-stock` | yes | any logged-in user | order.routes |
| POST | `/api/orders/create-order` | yes | any logged-in user | order.routes |
| POST | `/api/orders/:id/cancel` | yes | any logged-in user | order.routes |
| POST | `/api/payments/verify` | yes | any logged-in user | payments.routes |
| POST | `/api/payments/verify-booking` | yes | any logged-in user | payments.routes |
| POST | `/api/sos/create` | yes | any logged-in user | sos.routes |
| GET | `/api/sos/list` | yes | admin.super, admin.therapy | sos.routes |
| POST | `/api/sos/resolve` | yes | admin.super, admin.therapy | sos.routes |
| POST | `/api/consent/log` | no | public (no login) | consent.routes |
| GET | `/api/consent/list` | yes | admin.super | consent.routes |
| GET | `/api/invoices/list` | yes | any logged-in user | invoices.routes |
| GET | `/api/therapists/list` | no | public (no login) | therapist.routes |
| POST | `/api/therapists/register` | no | public (no login) | therapist.routes |
| GET | `/api/therapists/profile/:userId` | yes | any logged-in user | therapist.routes |
| PUT | `/api/therapists/profile/:userId` | yes | any logged-in user | therapist.routes |
| POST | `/api/therapists/availability` | yes | admin.super, therapist | therapist.routes |
| GET | `/api/therapists/availability/:therapistId` | yes | admin.super, therapist, admin.ecom, admin.therapy | therapist.routes |
| POST | `/api/therapists/document` | yes | admin.super, therapist | therapist.routes |
| GET | `/api/therapists/listnearby` | no | public (no login) | therapist.routes |
| GET | `/api/therapists/dashboard-stats/:therapistId` | yes | admin.super, therapist, admin.ecom, admin.therapy | therapist.routes |
| GET | `/api/therapists/earnings/:therapistId` | yes | admin.super, therapist, admin.ecom, admin.therapy | therapist.routes |
| POST | `/api/therapists/leaves` | yes | admin.super, therapist | therapist.routes |
| GET | `/api/therapists/leaves` | yes | admin.super, therapist, admin.ecom, admin.therapy | therapist.routes |
| DELETE | `/api/therapists/leaves/:id` | yes | admin.super, therapist | therapist.routes |
| GET | `/api/notifications/list/:id` | yes | any logged-in user | notifications.routes |
| GET | `/api/notifications/unread-count/:id` | yes | any logged-in user | notifications.routes |
| POST | `/api/notifications/read/:id` | yes | any logged-in user | notifications.routes |
| GET | `/api/appointments` | yes | admin.super, admin.ecom, admin.therapy | appointments.routes |
| GET | `/api/appointments/user/:userId/:role` | yes | any logged-in user | appointments.routes |
| GET | `/api/appointments/pcr-list` | yes | admin.super, admin.therapy | appointments.routes |
| GET | `/api/appointments/:id` | yes | any logged-in user | appointments.routes |
| POST | `/api/appointments/request` | yes | any logged-in user | appointments.routes |
| GET | `/api/appointments/requests/available` | yes | admin.super, therapist | appointments.routes |
| POST | `/api/appointments/accept/:id` | yes | admin.super, therapist | appointments.routes |
| POST | `/api/appointments/reject/:id` | yes | admin.super, therapist | appointments.routes |
| PUT | `/api/appointments/status/:id` | yes | any logged-in user | appointments.routes |
| POST | `/api/appointments/:id/pay` | yes | admin.super, admin.therapy, admin.ecom | appointments.routes |
| PATCH | `/api/appointments/:id/cancel` | yes | any logged-in user | appointments.routes |
| POST | `/api/appointments/:id/cancel` | yes | any logged-in user | appointments.routes |
| POST | `/api/appointments/create-appointment` | yes | any logged-in user | appointments.routes |
| POST | `/api/appointments/:id/review` | yes | any logged-in user | appointments.routes |
| GET | `/api/appointments/pcr/:appointmentId` | yes | any logged-in user | appointments.routes |
| PATCH | `/api/appointments/pcr/:appointmentId` | yes | any logged-in user | appointments.routes |
| PUT | `/api/appointments/reschedule/:id` | yes | any logged-in user | appointments.routes |
| POST | `/api/general/audit-logs/add` | yes | any logged-in user | general.routes |
| POST | `/api/general/payout-items/add` | yes | admin.super, admin.therapy | general.routes |
| GET | `/api/general/payout-items/source/:sourceId` | yes | admin.super, admin.therapy, therapist | general.routes |
| GET | `/api/general/payout-items/list` | yes | admin.super, admin.therapy, therapist | general.routes |
| PUT | `/api/general/payout-items/:id/state` | yes | admin.super, admin.therapy | general.routes |
| PUT | `/api/general/payout-items/source/:sourceId/state` | yes | admin.super, admin.therapy | general.routes |
| POST | `/api/general/knowledge-base/add` | yes | admin.super, admin.ecom, admin.therapy, therapist | general.routes |
| GET | `/api/general/knowledge-base/get-by-id/:id` | yes | any logged-in user | general.routes |
| GET | `/api/general/knowledge-base/list` | yes | any logged-in user | general.routes |
| GET | `/api/general/knowledge-base/post-get-public` | no | public (no login) | general.routes |
| PUT | `/api/general/knowledge-base/update/:id` | yes | admin.super, admin.ecom, admin.therapy, therapist | general.routes |
| PATCH | `/api/general/knowledge-base/:id/status` | yes | admin.super, admin.therapy | general.routes |
| DELETE | `/api/general/knowledge-base/delete/:id` | yes | admin.super, admin.therapy | general.routes |
| GET | `/api/general/knowledge-base/:slug` | no | public (no login) | general.routes |
| GET | `/api/service-types/list` | no | public (no login) | service_types.routes |
| POST | `/api/service-types/add` | yes | admin.super, admin.therapy | service_types.routes |
| PUT | `/api/service-types/update/:id` | yes | admin.super, admin.therapy | service_types.routes |
| DELETE | `/api/service-types/delete/:id` | yes | admin.super, admin.therapy | service_types.routes |
| POST | `/api/support/tickets` | yes | any logged-in user | support.routes |
| GET | `/api/support/tickets` | yes | any logged-in user | support.routes |
| GET | `/api/support/tickets/:id` | yes | any logged-in user | support.routes |
| POST | `/api/support/tickets/reply` | yes | any logged-in user | support.routes |
| POST | `/api/support/tickets/:id/close` | yes | any logged-in user | support.routes |
| POST | `/api/support/contact-us` | no | public (no login) | support.routes |
| POST | `/api/shipment/create` | yes | admin.super, admin.ecom | shipment.routes |
| GET | `/api/shipment/list` | yes | admin.super, admin.ecom | shipment.routes |
| GET | `/api/shipment/estimate` | no | public (no login) | shipment.routes |
| GET | `/api/shipment/:id` | yes | admin.super, admin.ecom | shipment.routes |
| GET | `/api/shipment/track/:awb` | no | public (no login) | shipment.routes |
| POST | `/api/shipment/cancel/:id` | yes | admin.super, admin.ecom | shipment.routes |
| GET | `/api/stats/public` | no | public (no login) | stats.routes |
| GET | `/api/reviews/product/:productId` | no | public (no login) | review.routes |
| POST | `/api/reviews` | yes | any logged-in user | review.routes |
| GET | `/api/reviews/user` | yes | any logged-in user | review.routes |
| PUT | `/api/reviews/:id` | yes | any logged-in user | review.routes |
| DELETE | `/api/reviews/:id` | yes | any logged-in user | review.routes |
| GET | `/api/offers/list` | no | public (no login) | offers.routes |
| GET | `/api/offers/:id` | no | public (no login) | offers.routes |
| POST | `/api/offers/create` | yes | admin.super, admin.ecom | offers.routes |
| PUT | `/api/offers/update/:id` | yes | admin.super, admin.ecom | offers.routes |
| DELETE | `/api/offers/delete/:id` | yes | admin.super, admin.ecom | offers.routes |

Total routes: 170

## Added in P12 (visit flow)

| Method | Path | Who |
|---|---|---|
| GET | /api/appointments/:id/otp | the booking's patient only, from 2 h before the slot until the slot ends |
| POST | /api/appointments/:id/verify-start-otp | the assigned therapist only, status must be `arrived` |
| GET | /api/config/public | anyone (non-secret rule values) |
| PUT | /api/appointments/status/:id | any party of the booking; the state machine (`src/services/appointmentStateMachine.js`) decides who may do which move |

## Added in P13 / P14

| Method | Path | Who |
|---|---|---|
| GET | /api/therapists/:therapistId/slots?date=YYYY-MM-DD | anyone (public) - bookable hourly slots, decided by the server |
| GET | /api/appointments/:id/cancel-quote | patient (own), assigned therapist, clinical admin - what cancelling costs right now |
| POST/PATCH | /api/appointments/:id/cancel | patient (own), assigned therapist (reason required), clinical admin (reason required) - applies the policy and refunds through Razorpay |
