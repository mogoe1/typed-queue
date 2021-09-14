// file: worker.js
import { TypedQueue } from "../lib/TypedQueue.js";

self.addEventListener("message", message => {
    const typedQueue = new TypedQueue(message.data);
    while(true){
        console.log("received", typedQueue.dequeue());
    }
});
