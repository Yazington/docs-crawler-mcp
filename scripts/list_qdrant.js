import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({ url: "http://localhost:6333" });
const COLLECTION_NAME = "docs_chunks";

async function listQdrantPoints() {
  try {
    const response = await qdrant.scroll(COLLECTION_NAME, {
      limit: 10,
      with_payload: true,
      with_vector: false, // omit vectors for brevity
    });

    console.log(
      `Found ${response.points.length} points in "${COLLECTION_NAME}":\n`
    );

    for (const point of response.points) {
      console.log(`ID: ${point.id}`);
      console.log(`Payload: ${JSON.stringify(point.payload, null, 2)}\n`);
    }
  } catch (err) {
    console.error("Error listing Qdrant points:", err);
  }
}

listQdrantPoints();
