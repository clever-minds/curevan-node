#!/bin/bash
# Read-only / refused-request probes of the LIVE API. No account is created, no login is attempted, nothing is paid.
A=https://api.curevan.com
O="Origin: https://www.curevan.com"
n=0; bad=0
t() { # name expected method path [data]
  local name="$1" exp="$2" m="$3" p="$4" d="$5" code
  if [ -n "$d" ]; then code=$(curl -s -m 25 -o /tmp/lp.txt -w "%{http_code}" -X "$m" -H "$O" -H "content-type: application/json" -d "$d" "$A$p"); else code=$(curl -s -m 25 -o /tmp/lp.txt -w "%{http_code}" -X "$m" -H "$O" "$A$p"); fi
  n=$((n+1)); local ok="PASS"; case " $exp " in *" $code "*) ;; *) ok="FAIL"; bad=$((bad+1));; esac
  printf "%-4s %-58s expected %-8s got %s\n" "$ok" "$name" "$exp" "$code"
}
echo "== public settings (P01, P14, P19, P20, P25, P27, P28)"
t "P01 public config answers" 200 GET /api/config/public
t "P25 legal entity answers" 200 GET /api/config/legal-entity
t "service types answer" 200 GET /api/service-types/list
echo "== protected routes refuse an anonymous caller (P03, P04, P05, P10, P12-P28)"
for r in "P03 users list|/api/users/list" "P03 orders of a user|/api/orders/my-orders" "P03 returns (admin)|/api/orders/returns" "P03 PCR list (admin)|/api/appointments/pcr-list" "P04 an appointment|/api/appointments/1" "P12 start code|/api/appointments/1/otp" "P14 cancel quote|/api/appointments/1/cancel-quote" "P15 a PCR|/api/appointments/pcr/1" "P15 PCR pdf|/api/pcr/1/pdf" "P16 clinical plans|/api/clinical/plans" "P18 payout batches|/api/payout-batches/list" "P21 patient dashboard|/api/patients/me/dashboard" "P22 therapy admin queue|/api/therapy-admin/emergency-queue" "P24 notifications count|/api/notifications/unread-count/1" "P25 privacy export|/api/privacy/export" "P25 privacy admin list|/api/privacy/admin/requests" "P28 my care packs|/api/care-packs/my-packs" "P30 follow-up options|/api/appointments/1/follow-up-options"; do t "${r%%|*}" "401 403" GET "${r##*|}"; done
echo "== writes without a login are refused"
t "P05 role change" "401 403" POST /api/users/update-roles '{"userId":1,"roles":["admin.super"]}'
t "P05 phone login without Firebase token" "400 401" POST /api/auth/login-with-mobile '{"phone":"9000000000"}'
t "P05 forged Firebase token" "400 401 403" POST /api/auth/login-with-mobile '{"firebaseIdToken":"forged.token.value"}'
t "P06 shop order" "401 403" POST /api/orders/create-order '{}'
t "P06 coupon apply" "401 403" POST /api/coupons/apply '{"code":"X"}'
t "P07 booking" "401 403" POST /api/appointments/create-appointment '{"bookingData":{}}'
t "P10 SOS" "401 403" POST /api/sos/create '{}'
t "P26 chat escalation" "401 403" POST /api/support/chat/sessions '{}'
t "P27 masked call" "401 403" POST /api/communication/mask-call '{"appointmentId":1}'
t "P20 generate DR codes" "401 403" POST /api/coupons/generate-missing '{}'
echo "== webhooks refuse a caller without the secret (P08, P19, P27)"
t "P08 Razorpay webhook, bad signature" "400 401 403" POST /api/payments/webhook '{"event":"payment.captured"}'
t "P19 courier webhook, no token" "401 403" POST /api/hooks/logistics '{"awb":"X"}'
t "P27 telephony webhook, no token" "401 403" POST /api/hooks/telephony '{"CallSid":"X"}'
echo "== therapists and slots (P13, P22)"
t "P22 therapist list" 200 GET /api/therapists/list
t "P22 therapists near a place" 200 GET "/api/therapists/listnearby?lat=22.3&lng=73.19&radius=50"
TID=$(curl -s -m 25 $A/api/therapists/list | python -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
t "P13 open slots of a real therapist (id ${TID:-?})" 200 GET "/api/therapists/${TID:-0}/slots?date=2026-11-05"
echo "== CORS (P01)"
for o in https://www.curevan.com https://curevan.com; do h=$(curl -s -m 20 -o /dev/null -D - -H "Origin: $o" $A/api/config/public | grep -ic "access-control-allow-origin: $o"); n=$((n+1)); [ "$h" = "1" ] && echo "PASS CORS allows $o" || { echo "FAIL CORS does not allow $o"; bad=$((bad+1)); }; done
h=$(curl -s -m 20 -o /dev/null -D - -H "Origin: https://evil.example" $A/api/config/public | grep -ic "access-control-allow-origin"); n=$((n+1)); [ "$h" = "0" ] && echo "PASS CORS refuses an unknown website" || { echo "FAIL CORS lets an unknown website in"; bad=$((bad+1)); }
echo; echo "$((n-bad))/$n live probes passed"
