import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({ url: "http://localhost:6333" });
const COLLECTION_NAME = "docs_chunks";

async function resetQdrantCollection() {
  try {
    console.log(`Deleting collection "${COLLECTION_NAME}"...`);
    await qdrant.deleteCollection(COLLECTION_NAME);
  } catch (err) {
    console.warn(
      `Warning: Could not delete collection (may not exist):`,
      err.message
    );
  }

  console.log(`Creating collection "${COLLECTION_NAME}"...`);
  await qdrant.createCollection(COLLECTION_NAME, {
    vectors: {
      size: 384, // embedding dimension for MiniLM
      distance: "Cosine",
    },
  });

  console.log(`Collection "${COLLECTION_NAME}" has been reset.`);
}

resetQdrantCollection().catch((err) => {
  console.error("Error resetting Qdrant collection:", err);
});
