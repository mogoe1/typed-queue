// file: main.js
import { TypedQueue, TypedQueueType} from "../lib/TypedQueue.js";

const typedQueue = new TypedQueue(TypedQueueType.uint8, 5);
const worker = new Worker("./example/worker.js", { type: "module" });

worker.postMessage(typedQueue.info);

window.setTimeout(async () => {
    await typedQueue.enqueueChunckAsync([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}, 1000);

