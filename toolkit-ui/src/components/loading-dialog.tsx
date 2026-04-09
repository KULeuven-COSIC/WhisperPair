import { LoaderCircle } from "lucide-react";
import React from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface LoadingDialogProps {
  open: boolean;
  title?: string;
  onCancel?: () => Promise<void>;
}

/** Loading dialog. */
export default function LoadingDialog({
  open,
  title = "Loading...",
  onCancel,
}: LoadingDialogProps) {
  const [isLoading, setIsLoading] = React.useState(false);

  async function handleCancel() {
    setIsLoading(true);
    try {
      if (onCancel) await onCancel();
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="flex flex-col items-center py-4 pb-7 gap-6">
        <AlertDialogHeader className="flex flex-col items-center gap-4">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            <LoaderCircle className="animate-spin size-12" />
          </AlertDialogDescription>
        </AlertDialogHeader>
        {onCancel && (
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
              Cancel {isLoading && <LoaderCircle className="animate-spin" />}
            </AlertDialogCancel>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
