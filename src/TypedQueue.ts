import { ReentrantLock } from "@mogoe1/reentrant-lock";

type TypedArray =
    Uint8Array
    | Int8Array
    | Uint16Array
    | Int16Array
    | Uint32Array
    | Int32Array;

type TypedArrayConstructor =
    { BYTES_PER_ELEMENT: number, new(): TypedArray; new(elements: Iterable<number>): TypedArray; new(length: number): TypedArray; new(array: ArrayLike<number> | ArrayBufferLike): TypedArray; new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): TypedArray; }

enum TypedQueueType {
    uint8 = 0,
    int8 = 1,
    uint16 = 2,
    int16 = 3,
    uint32 = 4,
    int32 = 5
}

const TypedQueueTypeInfo: { [key in TypedQueueType]: TypedArrayConstructor } = {
    [TypedQueueType.uint8]: Uint8Array,
    [TypedQueueType.uint16]: Uint16Array,
    [TypedQueueType.int8]: Int8Array,
    [TypedQueueType.int16]: Int8Array,
    [TypedQueueType.uint32]: Uint32Array,
    [TypedQueueType.int32]: Int32Array
};

const enum HEAD_ARRAY_POSITIONS {
    TYPE = 0,
    CAPACITY = 1,
    LOCK = 2,
    FRONT_INDEX = 3,
    CURR_SIZE = 4,
    __LENGTH
}

const HEAD_ARRAY_SIZE = HEAD_ARRAY_POSITIONS.__LENGTH;

class TypedQueue {
    private _headArray: Int32Array;
    private _lock: ReentrantLock;
    private _dataArray: TypedArray;

    constructor(type: TypedQueueType, capacity: number);

    constructor(type: TypedQueueType, buffer: SharedArrayBuffer, byteOffset: number, capacity: number)

    constructor(info: Int32Array)

    constructor(arg0: TypedQueueType | Int32Array, arg1?: number | SharedArrayBuffer, byteOffset?: number, capacity?: number) {
        let typedQueueType: TypedQueueType;

        if (typeof arg0 === "number" && typeof arg1 === "number" && byteOffset === undefined && capacity === undefined) {
            typedQueueType = arg0;
            const capacity = arg1;

            const DataArrayConstructor = TypedQueueTypeInfo[typedQueueType];
            const bufferSize = (Int32Array.BYTES_PER_ELEMENT * HEAD_ARRAY_SIZE) + (DataArrayConstructor.BYTES_PER_ELEMENT * capacity);

            const buffer = new SharedArrayBuffer(bufferSize);

            this._headArray = new Int32Array(buffer, 0, HEAD_ARRAY_SIZE);
            this._headArray[HEAD_ARRAY_POSITIONS.CAPACITY] = capacity;
            this._headArray[HEAD_ARRAY_POSITIONS.LOCK] = 1;
            this._headArray[HEAD_ARRAY_POSITIONS.TYPE] = typedQueueType;
        } else if (typeof arg0 === "number" && arg1 instanceof SharedArrayBuffer && typeof byteOffset === "number" && typeof capacity === "number") {
            typedQueueType = arg0;
            const buffer = arg1;

            this._headArray = new Int32Array(buffer, byteOffset, HEAD_ARRAY_SIZE);
            this._headArray[HEAD_ARRAY_POSITIONS.CAPACITY] = capacity;
            this._headArray[HEAD_ARRAY_POSITIONS.LOCK] = 1;
            this._headArray[HEAD_ARRAY_POSITIONS.TYPE] = typedQueueType;
        } else if (arg0 instanceof Int32Array) {
            this._headArray = arg0;
            typedQueueType = this._headArray[HEAD_ARRAY_POSITIONS.TYPE];
        } else {
            throw new Error("No TypedQueue constructor matches your arguments");
        }

        const DataArrayConstructor = TypedQueueTypeInfo[typedQueueType];
        const dataArrayOffset = this._headArray.byteOffset + this._headArray.byteLength;
        const dataArrayLength = this._headArray[HEAD_ARRAY_POSITIONS.CAPACITY];
        this._dataArray = new DataArrayConstructor(this._headArray.buffer, dataArrayOffset, dataArrayLength);

        const lockArrayOffset = this._headArray.byteOffset + HEAD_ARRAY_POSITIONS.LOCK * this._headArray.BYTES_PER_ELEMENT;
        this._lock = new ReentrantLock(new Int32Array(this._headArray.buffer, lockArrayOffset, 1));
    }

    public get buffer(): SharedArrayBuffer {
        return this._dataArray.buffer as SharedArrayBuffer;
    }

    public get byteLength(): number {
        return this._dataArray.byteLength + this._headArray.byteLength;
    }

    public get byteOffset(): number {
        return this._headArray.byteOffset;
    }

    public get capacity(): number {
        return this._dataArray.length;
    }

    public get size(): number {
        return Atomics.load(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE);
    }

    private set size(value: number) {
        Atomics.store(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE, value);
    }

    public get info(): Int32Array {
        return this._headArray;
    }

    // points to the first element of the queue that can be dequeued if the queue is not empty
    private get _frontIndex(): number {
        return Atomics.load(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX);
    }

    private set _frontIndex(value: number) {
        value = value % this.capacity;
        Atomics.store(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX, value);
    }

    // points to the place where the next element should be added
    private get _nextFreeIndex(): number {
        if (this.isFull) {
            return null;
        }
        return (this._frontIndex + this.size) % this.capacity;
    }

    public get isFull(): boolean {
        return this.size >= this.capacity;
    }

    public get lock(): ReentrantLock {
        return this._lock;
    }

    public enqueueChunck(data: Uint8Array | number[], blocking = true): void {
        this._lock.lock();

        if (!blocking && data.length > (this.capacity - this.size)) {
            this._lock.unlock();
            throw new Error("Not enough space available");
        }

        for (let i = 0; i < data.length; i++) {
            while (this.isFull) {
                const frontIndex = this._frontIndex;
                Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE); // make sure others know we are full and they meight start reading
                this._lock.unlock();

                Atomics.wait(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX, frontIndex);
                this._lock.lock();
            }
            this._enqueue(data[i]);
        }

        Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE);
        this._lock.unlock();
    }

    public async enqueueChunckAsync(data: Uint8Array | number[], blocking = true): Promise<void> {
        await this._lock.lockAsync();

        if (!blocking && data.length > (this.capacity - this.size)) {
            this._lock.unlock();
            throw new Error("Not enough space available");
        }

        for (let i = 0; i < data.length; i++) {
            while (this.isFull) {
                const frontIndex = this._frontIndex;
                Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE); // make sure others know we are full and they meight start reading
                this._lock.unlock();

                await (Atomics as Atomics & { waitAsync: CallableFunction }).waitAsync(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX, frontIndex).value;
                await this._lock.lockAsync();
            }
            this._enqueue(data[i]);
        }

        Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE);
        this._lock.unlock();
    }

    public enqueue(byte: number, blocking = true): void {
        this.enqueueChunck([byte], blocking);
    }

    public async enqueueAsync(byte: number, blocking = true): Promise<void> {
        return this.enqueueChunckAsync([byte], blocking);
    }

    private _enqueue(byte: number) {
        Atomics.store(this._dataArray, this._nextFreeIndex, byte);
        this.size++;
    }

    public dequeue(blocking = true): number {
        this._lock.lock();

        if (!blocking && this.size === 0) {
            this._lock.unlock();
            throw new Error("No elements available");
        }

        while (this.size === 0) {
            Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX); // make sure others know we are empty and they meight start enqueuing
            this._lock.unlock();
            Atomics.wait(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE, 0);
            this._lock.lock();
        }

        const byte = this._dequeue();

        Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX);

        this._lock.unlock();

        return byte;
    }

    public async dequeueAsync(blocking = true): Promise<number> {
        await this._lock.lockAsync();

        if (!blocking && this.size === 0) {
            this._lock.unlock();
            throw new Error("No elements available");
        }

        while (this.size === 0) {
            Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX); // make sure others know we are empty and they meight start enqueuing
            this._lock.unlock();
            await (Atomics as Atomics & { waitAsync: CallableFunction }).waitAsync(this._headArray, HEAD_ARRAY_POSITIONS.CURR_SIZE, 0).value;
            await this._lock.lockAsync();
        }

        const byte = this._dequeue();

        Atomics.notify(this._headArray, HEAD_ARRAY_POSITIONS.FRONT_INDEX);
        this._lock.unlock();

        return byte;
    }

    private _dequeue(): number {
        const value = Atomics.load(this._dataArray, this._frontIndex);

        this._frontIndex++;
        this.size--;
        return value;
    }
}

export { TypedQueue, TypedQueueType };
