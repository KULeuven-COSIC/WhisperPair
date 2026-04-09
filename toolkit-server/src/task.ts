import { Socket } from "socket.io";

export class Task<Result> {
  name: string;
  description: string;

  promise: Promise<Result>;
  settled: boolean;
  abortController?: AbortController;

  timeout?: NodeJS.Timeout;

  constructor(
    name: string,
    description: string,
    promise: Promise<Result>,
    abortController?: AbortController,
  ) {
    this.name = name;
    this.description = description;
    this.promise = promise;
    this.abortController = abortController;

    this.settled = false;
    promise.finally(() => (this.settled = true));
  }

  setTimeout(duration: number) {
    if (this.timeout) throw new Error("A timeout has already been set for this task.");
    if (!this.abortController)
      throw new Error("Setting a timeout for a task requires an AbortController.");

    this.timeout = setTimeout(() => {
      if (!this.settled) this.abortController?.abort("timeout");
    }, duration);

    this.promise.finally(() => {
      if (this.timeout) clearTimeout(this.timeout);
    });
  }

  cancel() {
    if (!this.settled) this.abortController?.abort("cancelled");
  }

  get cancellable() {
    return !!this.abortController;
  }

  static fromPromise<T>(
    name: string,
    description: string,
    promise: Promise<T> | [Promise<T>, AbortController],
    timeout?: number,
  ): Task<T> {
    let task: Task<T> | undefined = undefined;

    if (promise instanceof Promise) task = new Task(name, description, promise);

    if (
      Array.isArray(promise) &&
      promise.length == 2 &&
      promise[0] instanceof Promise &&
      promise[1] instanceof AbortController
    )
      task = new Task(name, description, promise[0], promise[1]);

    if (!task) throw new Error("Invalid promise for task.");
    if (timeout !== undefined) task.setTimeout(timeout);

    return task;
  }

  toJSON() {
    return {
      name: this.name,
      description: this.description,
      cancellable: this.cancellable,
    };
  }
}

type TaskOptions = {
  name: string;
  description: string;
  timeout?: number;
  cancellable?: boolean;
};

export class TaskManager {
  currentTask: Task<any> | undefined;
  sockets: Set<Socket>;

  constructor(sockets: Set<Socket>) {
    this.currentTask = undefined;
    this.sockets = sockets;
  }

  private updateCurrentTask(task: Task<any> | undefined) {
    this.currentTask = task;
    this.sockets.forEach((socket) => socket.emit("currentTask", task));
  }

  run<T>(start: (abortController?: AbortController) => Promise<T>, options: TaskOptions) {
    if (this.currentTask) throw new Error("Task already running.");

    const controller = new AbortController();

    return new Promise<T>((resolve, reject) => {
      try {
        const promise = (options.cancellable ? start(controller) : start())
          .then(resolve)
          .catch(reject)
          .finally(() => this.updateCurrentTask(undefined));

        this.updateCurrentTask(
          Task.fromPromise(
            options.name,
            options.description,
            options.cancellable ? [promise, controller] : promise,
          ),
        );

        if (options.timeout) this.currentTask!.setTimeout(options.timeout);
      } catch (e) {
        reject(e);
      }
    });
  }

  cancelCurrentTask(timeout?: number) {
    const task = this.currentTask;

    if (!task) throw new Error("No active task.");
    if (!task.cancellable) throw new Error("Task cannot be cancelled.");

    task.cancel();

    if (timeout) {
      setTimeout(() => {
        if (!task.settled) {
          this.updateCurrentTask(undefined);
        }
      }, timeout);
    }

    return task.promise;
  }
}

export type AbortablePromise<T> = [Promise<T>, AbortController];
