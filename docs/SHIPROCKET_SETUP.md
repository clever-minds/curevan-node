# Shiprocket setup (courier updates)

## 1. Webhook address

In the Shiprocket panel: **Settings > API > Webhooks** (tracking updates).

| Field | Value |
|---|---|
| URL | `https://<your API host>/api/hooks/logistics` |
| Token (sent as the `x-api-key` header) | the same value you put in `SHIPROCKET_WEBHOOK_TOKEN` |

Shiprocket **rejects any URL that contains** `shiprocket`, `sr`, `kr` or `kartrocket`, which is why the path is `/api/hooks/logistics`.

## 2. Environment variables (`.env` of the API)

```
SHIPROCKET_API_EMAIL=...            # the API user created in Shiprocket
SHIPROCKET_API_PASSWORD=...
SHIPROCKET_WEBHOOK_TOKEN=...        # long random string; also entered in the panel above
```

## 3. Events to switch on

AWB assigned, Pickup scheduled / Picked up, In transit, Out for delivery, Delivered, RTO (initiated, in transit, delivered), Cancelled.
Reverse (return) shipments use the same hook: our return orders are named `RET-<order number>-<return id>`, which is how an event is matched to a return.

## 4. What the hook does

| Courier status | Order status |
|---|---|
| AWB assigned | `awb_generated` |
| Picked up | `picked_up` |
| In transit | `in_transit` |
| Out for delivery | `out_for_delivery` |
| Delivered | `delivered` (and `delivered_at` is saved: the return window counts from it) |
| any RTO status | `rto` |
| Cancelled | `Cancelled` |

- A call without the right token gets **401** and nothing is stored. Every accepted call gets **200** straight away.
- Every event is stored in `shipment_events` (the same event twice is stored once). Late or repeated events never move an order backwards, and an `rto` / cancelled / return-approved order is never revived.
- Return shipments move the **return**: pickup scheduled > in transit > received (and the shop admins are told when it arrives).

## 5. Rules owned by the settings file (`src/config/businessRules.js`, `shop`)

- Shipping: free when the goods value after discounts (tax included) is at least `freeShippingThresholdInr` (499), otherwise `flatShippingFeeInr` (50). Shiprocket's quote is only used to choose a courier.
- Returns: only after delivery and within `returnWindowDays` (7) of `delivered_at`; reasons `damaged`, `defective`, `wrong_item`, `missing_part`; a photo is required for damaged/defective; categories with `categories.non_returnable = true` cannot be returned.
- Refund: after the warehouse marks the return received, an inspection **pass** refunds the returned items' share of what was paid for goods through Razorpay; a **fail** rejects the return.

## 6. Token cache

The Shiprocket login token is cached for 9 days (it lives 10). Restarting the API fetches a new one.
