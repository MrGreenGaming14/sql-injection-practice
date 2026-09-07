/* The secret endpoint supplies structured telemetry; server logs remain authoritative. */
function showSocAlert(event) { if (!event) return; console.warn("SOC training alert", event); window.alert(`SOC alert: ${event.filename} requested from ${event.ip} at ${event.timestamp}`); }
async function monitorSecret(url) { const response = await fetch(url, { headers: { Accept: "application/json" } }); const payload = await response.json(); showSocAlert(payload.event); return payload; }
if (window.secretEvent) showSocAlert(window.secretEvent);
