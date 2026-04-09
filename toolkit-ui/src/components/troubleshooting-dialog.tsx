import { LoaderCircleIcon, WrenchIcon } from "lucide-react";
import { toast } from "sonner";
import React from "react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Options for troubleshooting. */
export default function TroubleshootingOptions() {
  /** State for the reset confirm dialog. */
  const [openConfirmDialog, setOpenConfirmDialog] = React.useState(false);
  /** State for the reset fetch request. */
  const [resetLoading, setResetLoading] = React.useState(false);
  /** Error for the reset fetch request. */
  const [resetError, setResetError] = React.useState("");

  /** Resets the backend. */
  async function reset() {
    setResetLoading(true);
    setResetError("");

    try {
      const response = await fetch("/reset", { method: "POST" });
      if (!response.ok) throw new Error(response.statusText);
      setOpenConfirmDialog(false);
      toast.success("Adapter reset successfully!");
    } catch (e) {
      if (e instanceof Error) {
        setResetError(e.message);
      } else {
        setResetError(`${e}`);
      }
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <AlertDialog open={openConfirmDialog} onOpenChange={setOpenConfirmDialog}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="rounded-full">
            <WrenchIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Troubleshooting options</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <AlertDialogTrigger>Reset BLE adapter</AlertDialogTrigger>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure you want to reset the BLE adapter?</AlertDialogTitle>
          <AlertDialogDescription>
            The following commands will be executed on the host system:
          </AlertDialogDescription>

          <div className="font-mono border-input dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 shadow-xs outline-none text-sm">
            <div>hciconfig hci0 down</div>
            <div>hciconfig hci0 reset</div>
            <div>hciconfig hci0 up</div>
            <div>systemctl restart bluetooth</div>
          </div>

          <AlertDialogDescription>
            Active Bluetooth connections will be temporarily interrupted.
          </AlertDialogDescription>

          {resetError && (
            <div className="text-destructive text-sm">An error occurred: {resetError}</div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={resetLoading}
            onClick={(e) => {
              e.preventDefault();
              reset();
            }}
          >
            Reset {resetLoading && <LoaderCircleIcon className="animate-spin" />}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
