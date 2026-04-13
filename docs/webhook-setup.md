# WAHA Webhook Setup Guide

## Purpose

This webhook tracks WhatsApp message timing by receiving events from WAHA (WhatsApp API) when messages are received and sent. It processes messages containing experiment IDs and tracks their timing through Redis streams.

## Webhook URL

```
https://your-domain.com/api/waha/webhook
```

## WAHA Configuration

### Enable Webhooks

1. Access your WAHA configuration
2. Enable the webhooks feature

### Set Webhook URL

Set your webhook URL to point to your backend:

```
https://your-domain.com/api/waha/webhook
```

### Subscribe to Events

Subscribe to these essential events:

- `message.received` - When WhatsApp messages are received
- `message.sent` - When WhatsApp messages are sent

### Save Configuration

1. Save your configuration
2. Verify the webhook is active by checking WAHA logs

## Testing

Test the webhook manually using this curl command:

```bash
curl -X POST https://your-domain.com/api/waha/webhook \
  -H "Content-Type: application/json" \
  -d '{"eventType":"message.received","from":"test","body":"!lapor test [EXP-001]"}'
```

This will simulate a received message with experiment ID `[EXP-001]`.

## Verification

Check that messages are being processed correctly in Redis streams:

```bash
redis-cli XRANGE whatsapp:incoming - +
```

This command shows all incoming messages in the Redis stream.

## Troubleshooting

### Webhook Not Receiving Events

- Check WAHA logs for webhook connection errors
- Verify your backend URL is accessible from WAHA
- Ensure your backend is running and responding on port 3000

### CORS Errors

- Ensure your backend allows CORS requests from WAHA
- Check that your server is configured with proper CORS headers

### Experiment ID Not Parsing

- Verify the message format: `[EXP-001]`
- Check that the message contains square brackets around the experiment ID
- Ensure the experiment ID follows the format `[EXP-XXX]` where XXX is a number