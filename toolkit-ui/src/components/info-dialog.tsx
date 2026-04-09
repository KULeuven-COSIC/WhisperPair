import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertCircleIcon } from "lucide-react";
import { Button } from "./ui/button";
import React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** An information dialog that is shown when the toolkit is started for the first time. */
export default function InfoDialog() {
  const [open, setOpen] = React.useState(false);

  /** Read the state from local storage. */
  React.useEffect(() => {
    try {
      const closedWelcome = localStorage.getItem("closedWelcome");
      // open the dialog if this is the first time
      if (!closedWelcome) {
        setOpen(true);
      }
    } catch {}

    function onOpen() {
      setOpen(true);
    }

    // allow opening the dialog by emitting an event on document
    document.addEventListener("openInfoDialog", onOpen);

    return () => {
      document.removeEventListener("openInfoDialog", onOpen);
    };
  }, []);

  function onOpenChange(open: boolean) {
    setOpen(open);

    // write to local storage if closed
    if (!open) {
      try {
        localStorage.setItem("closedWelcome", "yes");
      } catch {}
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl! text-center" showCloseButton={false}>
          <DialogHeader className="text-center">
            <DialogTitle className="text-center text-xl">
              Welcome to the WhisperPair toolkit
            </DialogTitle>

            <DialogDescription className="text-base text-primary text-center">
              This toolkit allows you to the perform the WhisperPair attacks described in the paper
              "
              <span className="italic">
                One Tap To Hijack Them All: A Security Analysis of the Google Fast Pair Protocol
              </span>
              ".
            </DialogDescription>

            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Do not attack third-party devices</AlertTitle>
              <AlertDescription>
                <span>
                  By running this tool you agree to use it only for defensive research, reproduction
                  of our results, or device self-testing.
                </span>

                <span>
                  Do not use it to attack third-party devices without clear written permission.
                </span>
              </AlertDescription>
            </Alert>

            <div className="text-center text-sm text-muted-foreground">
              <div>For more details on how to use this toolkit, please consult the README.</div>
              <div>
                For technical details on how the attack works, please consult{" "}
                <a
                  href="https://whisperpair.eu"
                  target="_blank"
                  className="underline text-blue-600"
                >
                  whisperpair.eu
                </a>
              </div>
            </div>

            <div className="flex justify-center mt-3">
              <DialogClose asChild>
                <Button>Get started</Button>
              </DialogClose>
            </div>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
