export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.FAL_KEY) return res.status(500).json({ error: "FAL_KEY not configured" });

  const { action, appId, requestId, input } = req.body;

  try {
    let url, method, body;

    if (action === "submit") {
      url = `https://queue.fal.run/${appId}`;
      method = "POST";
      body = JSON.stringify(input);
    } else if (action === "status") {
      url = `https://queue.fal.run/${appId}/requests/${requestId}/status`;
      method = "GET";
    } else if (action === "result") {
      url = `https://queue.fal.run/${appId}/requests/${requestId}`;
      method = "GET";
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Key ${process.env.FAL_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body } : {}),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };