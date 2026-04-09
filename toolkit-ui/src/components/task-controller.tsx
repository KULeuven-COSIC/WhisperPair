import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";
import React from "react";

import { socket } from "@/lib/socket";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A task that is being executed on the backend. */
export interface Task {
  /** The name of the task. */
  name: string;
  /** A description for the task. */
  description: string;
  /** Whether the task can be cancelled or not. */
  cancellable: boolean;
}

/** Props for the TaskController component. */
export interface TaskControllerProps {
  /** The task currently executing on the backend, if any. */
  currentTask: Task | undefined;
}

/** A component for controlling task execution on the backend. */
export default function TaskController({ currentTask }: TaskControllerProps) {
  /** Whether the task is being cancelled or not. */
  const [cancelling, setCancelling] = React.useState(false);

  /** Cancels a task. */
  function cancelTask() {
    setCancelling(true);
    try {
      socket.emit("cancelCurrentTask", (result: any) => {
        setCancelling(false);
        if (result.ok) {
          toast.success("Task cancelled");
        } else {
          toast.error(`Task could not be cancelled: ${result.error}`);
        }
      });
    } catch {}
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className=" rounded-4xl" variant="outline">
          {currentTask ? (
            <>
              <LoaderCircleIcon className="animate-spin" />
              Task in progress...
            </>
          ) : (
            "No active tasks"
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Active tasks</DialogTitle>
          <DialogDescription>View and cancel active tasks.</DialogDescription>

          {currentTask ? (
            <div>
              <p className="font-semibold">{currentTask.name} </p>
              <p className="text-sm">{currentTask.description}</p>
              <div className="mt-1.5 flex justify-between items-center">
                <Badge variant="outline" className="h-7">
                  <LoaderCircleIcon className="animate-spin mr-1" /> In progress...
                </Badge>

                {currentTask.cancellable && (
                  <Button size="sm" onClick={cancelTask} disabled={cancelling}>
                    Cancel
                    {cancelling && <LoaderCircleIcon className="animate-spin" />}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center mt-1 gap-2">
              <div>No active tasks</div>
            </div>
          )}
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
