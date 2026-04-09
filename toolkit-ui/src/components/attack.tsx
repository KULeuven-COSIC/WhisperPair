import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { format } from "date-fns";
import { toast } from "sonner";
import React from "react";
import { z } from "zod";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "./ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { extractAttErrorInfo } from "@/lib/att-errors";
import { knownModelIds } from "./set-model-id";
import { ScrollArea } from "./ui/scroll-area";
import { Checkbox } from "./ui/checkbox";
import { DeviceData } from "./device";
import { socket } from "@/lib/socket";
import { Button } from "./ui/button";

import {
  AlertCircleIcon,
  Check,
  CircleX,
  Info,
  InfoIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Schema for the attack form. */
const formSchema = z.object({
  attackType: z.enum(["pairingStatePredicate", "nonceReuse", "invalidCurve"]),
  reconnect: z.boolean().default(true).optional(),

  options: z
    .object({
      switchBack: z.boolean().default(false).optional(),
      bond: z.boolean().default(true).optional(),
      writeAccountKey: z.boolean().default(false).optional(),
    })
    .optional(),
});

interface ProgressUpdate {
  timestamp: Date;
  message: string;
}

export type UpdateReducerAction =
  | {
      type: "push";
      update: ProgressUpdate;
    }
  | { type: "clear" };

function updatesReducer(state: ProgressUpdate[], action: UpdateReducerAction) {
  if (action.type == "clear") return [];
  return [...state, action.update];
}

type AttackResult = { ok: false; error: string } | { ok: true; result: number };

/** Props for the Attack component. */
interface AttackProps {
  /** The targeted device. */
  device: DeviceData;
  hasCurrentTask?: boolean;
}

/** Attack view. */
export default function Attack({ device, hasCurrentTask }: AttackProps) {
  /** Open state of the attack dialog. */
  const [open, setOpen] = React.useState(false);
  /** Open state of the progress dialog. */
  const [progressOpen, setProgressOpen] = React.useState(false);
  /** Open state of the results dialog. */
  const [resultOpen, setResultOpen] = React.useState(false);
  /** Whether to show the logs or not. */
  const [showLogs, setShowLogs] = React.useState(false);
  /** Whether the attack is being cancelled. */
  const [cancelling, setCancelling] = React.useState(false);
  /** The attack results. */
  const [result, setResult] = React.useState<AttackResult | undefined>();
  /** Reference to the updates div element. */
  const updatesEndRef = React.useRef<HTMLDivElement>(null);

  /** Attack progress updates reducer. */
  const [updates, dispatch] = React.useReducer(updatesReducer, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      attackType: "" as any,
      reconnect: false,
      options: {
        switchBack: false,
        bond: true,
        writeAccountKey: false,
      },
    },
  });

  /** When a new update is added, scroll to the bottom. */
  React.useEffect(() => {
    updatesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, [updates]);

  const attackType = form.watch("attackType");

  /** Form submit handler. */
  function onSubmit(values: z.infer<typeof formSchema>) {
    setOpen(false);
    setProgressOpen(true);
    dispatch({ type: "clear" });
    dispatch({
      type: "push",
      update: { timestamp: new Date(), message: "Sent attack request" },
    });

    socket.emit(
      "attack",
      device.address,
      values.attackType,
      values.reconnect,
      values.options,
      (result: any) => {
        socket.off("attackProgress", onUpdate);
        setProgressOpen(false);
        setResultOpen(true);

        setResult(result);
      },
    );

    function onUpdate(update: any) {
      dispatch({
        type: "push",
        update: {
          timestamp: new Date(update.timestamp),
          message: update.message,
        },
      });
    }

    socket.on("attackProgress", onUpdate);
  }

  /** Reset the form. */
  function reset() {
    dispatch({ type: "clear" });
    setOpen(false);
    setProgressOpen(false);
    setResultOpen(false);
    setResult(undefined);
    setShowLogs(false);
  }

  /** Cancel the attack. */
  function handleCancel() {
    setCancelling(true);

    try {
      socket.emit("cancelCurrentTask", (result: any) => {
        setCancelling(false);
        if (result.ok) {
          setProgressOpen(false);
          setResultOpen(true);
          setResult({ ok: false, error: "Cancelled" });
        } else {
          toast.error(`Attack could not be cancelled: ${result.error}`);
        }
      });
    } catch {}
  }

  /** Detailed ATT error information if available */
  const attErrorInfo = React.useMemo(
    () => (!result?.ok && result?.error ? extractAttErrorInfo(result.error) : undefined),
    [result],
  );

  return (
    <>
      <Dialog open={result && resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="min-w-150">
          <DialogHeader className="flex flex-col items-center">
            <DialogTitle className="text-center">
              {result?.ok ? "Attack successful!" : "Attack failed"}
            </DialogTitle>
            <DialogDescription className="pt-3">
              {showLogs ? (
                <></>
              ) : result?.ok ? (
                <Check className="size-12" />
              ) : (
                <CircleX className="size-12" />
              )}
            </DialogDescription>
          </DialogHeader>

          {showLogs ? (
            <AttackLogs updates={updates} updatesEndRef={updatesEndRef} />
          ) : (
            <>
              <p className="text-center">
                {result?.ok
                  ? `Attack completed successfully in ${Math.round(result.result * 10) / 10000}s`
                  : result?.error}
              </p>

              {attErrorInfo?.code == 14 || attErrorInfo?.code == 129 ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>ATT error {attErrorInfo.codeStr}</AlertTitle>
                  <AlertDescription>
                    <span>
                      This error indicates a generic server-side failure on the accessory, often
                      indicating that the device has rejected the request.
                    </span>

                    {attackType == "pairingStatePredicate" ? (
                      <>
                        <span>
                          This indicates that the target device is not vulnerable, and is correctly
                          rejecting pairing requests while not in pairing mode. However, this error
                          sometimes occurs for vulnerable devices as well.
                        </span>
                        <span>
                          We recommend <span className="font-semibold">retrying the attack</span> a
                          couple of times. If it keeps failing with error {attErrorInfo.codeStr},
                          the device is probably not vulnerable.
                        </span>
                      </>
                    ) : (
                      <span>
                        Try performing this attack again, and ensure that the target device is in
                        pairing mode.
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              ) : attErrorInfo !== undefined ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>About this error</AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-col">
                      <span>Title: {attErrorInfo.title}</span>
                      <span>Description: {attErrorInfo.description}</span>
                    </div>

                    <span>
                      Try performing the attack again, or try restarting the Bluetooth adapter. If
                      the error persists, the device may not be vulnerable.
                    </span>
                  </AlertDescription>
                </Alert>
              ) : !result?.ok ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>General troubleshooting steps for failed attacks</AlertTitle>
                  <AlertDescription>
                    <span>You can use the following steps to troubleshoot issues:</span>
                    <ul className="list-disc ml-5">
                      <li>Retry the attack</li>
                      <li>Disconnect from the target device and reconnect</li>
                      <li>
                        Restart the target device (devices keep a count of failed pairings and
                        should reject every request after 10 attempts until a reboot)
                      </li>
                      <li>
                        Restart the Bluetooth adapter using the{" "}
                        <WrenchIcon className="inline size-3" /> troubleshooting menu
                      </li>
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <></>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowLogs(!showLogs)}>
              {!showLogs ? "Show" : "Hide"} logs
            </Button>
            <Button variant="outline" onClick={reset}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={progressOpen}>
        <AlertDialogContent className="min-w-150">
          <AlertDialogHeader>
            <AlertDialogTitle>Attack in progress...</AlertDialogTitle>
          </AlertDialogHeader>
          <AttackLogs updates={updates} updatesEndRef={updatesEndRef} />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel} disabled={cancelling}>
              Cancel {cancelling && <LoaderCircleIcon className="animate-spin" />}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" disabled={hasCurrentTask}>
            Attack
          </Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start attack</DialogTitle>
            <DialogDescription>Start an attack on this device.</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="attackType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Attack type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value} required>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select the type of attack" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="pairingStatePredicate">
                          Pairing state predicate enforcement
                        </SelectItem>
                        <SelectItem value="nonceReuse">Nonce re-use</SelectItem>
                        <SelectItem value="invalidCurve">Invalid curve</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {attackType == "pairingStatePredicate" ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>About the attack</AlertTitle>
                  <AlertDescription>
                    <span>
                      This attack attempts to write a pairing request to the Fast Pair service on
                      the target device.
                    </span>
                    <span>
                      <span className="font-bold">
                        Please ensure the target device is powered on but{" "}
                        <span className="underline">not</span> in pairing mode
                      </span>{" "}
                      as this attack is intended to test whether the target device accepts these
                      requests when not in pairing mode.
                    </span>
                  </AlertDescription>
                </Alert>
              ) : attackType == "nonceReuse" ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>About the attack</AlertTitle>
                  <AlertDescription>
                    <span>
                      This attack attempts to send pairing requests with reused nonces to the target
                      device.
                    </span>
                    <span>
                      <span className="font-bold">
                        Please ensure the target device is powered on and{" "}
                        <span className="underline">in</span> pairing mode
                      </span>
                      , as this ensures that the target device will accept pairing requests.
                    </span>
                  </AlertDescription>
                </Alert>
              ) : attackType == "invalidCurve" ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>About the attack</AlertTitle>
                  <AlertDescription>
                    <span>
                      This attack attempts to perform an invalid curve attack on the target device.
                    </span>
                    <span>
                      <span className="font-bold">
                        Please ensure the target device is powered on and{" "}
                        <span className="underline">in</span> pairing mode
                      </span>
                      , as this ensures that the target device will accept pairing requests.
                    </span>
                  </AlertDescription>
                </Alert>
              ) : (
                <></>
              )}

              {device.modelId && !Object.values(knownModelIds).includes(device.modelId.value) ? (
                <Alert className="text-amber-600">
                  <AlertCircleIcon />
                  <AlertTitle>Model not included in test set</AlertTitle>
                  <AlertDescription className="text-amber-600">
                    <span>
                      This model was not included in our evaluation. It may produce unexpected
                      results, depending on the reliability of the BLE chipset of the target device.
                    </span>

                    <span>
                      If you didn't expect this message, you might be using a model from a different
                      region. Check the README on <span className="italic">Selecting a device</span>{" "}
                      for more information.
                    </span>
                  </AlertDescription>
                </Alert>
              ) : (
                <></>
              )}

              {!device.modelId && (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertTitle>Model ID not set</AlertTitle>
                  <AlertDescription>
                    <span>Please set the Model ID of this device.</span>
                    <span>
                      You can set this device's Model ID by closing this dialog, clicking the "Read
                      Model ID" button (if available), or clicking the "Set Model ID" button.
                    </span>
                  </AlertDescription>
                </Alert>
              )}

              <FormField
                control={form.control}
                name="reconnect"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(reconnect) => field.onChange(reconnect)}
                      />
                    </FormControl>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <FormLabel className="text-sm font-normal">
                          Reconnect <Info className="size-4 text-muted-foreground" />
                        </FormLabel>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Disconnect and reconnect to the device before starting the attack</p>
                      </TooltipContent>
                    </Tooltip>
                  </FormItem>
                )}
              />
              {attackType == "pairingStatePredicate" && (
                <FormField
                  control={form.control}
                  name="options"
                  render={() => (
                    <FormItem>
                      <FormLabel className="text-base">Options</FormLabel>

                      <FormField
                        control={form.control}
                        name="options"
                        render={({ field }) => {
                          return (
                            <FormItem className="flex flex-row items-center gap-2">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.switchBack}
                                  onCheckedChange={(switchBack) =>
                                    field.onChange({
                                      ...field.value,
                                      switchBack,
                                    })
                                  }
                                />
                              </FormControl>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <FormLabel className="text-sm font-normal">
                                    Switch back <Info className="size-4 text-muted-foreground" />
                                  </FormLabel>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>
                                    Force the target device to switch back (reconnect) to the host
                                    that was connected before the attack, if the Audio Switch
                                    extension is supported
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </FormItem>
                          );
                        }}
                      />

                      <FormField
                        control={form.control}
                        name="options"
                        render={({ field }) => {
                          return (
                            <FormItem className="flex flex-row items-center gap-2">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.bond}
                                  onCheckedChange={(bond) =>
                                    field.onChange({ ...field.value, bond })
                                  }
                                />
                              </FormControl>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <FormLabel className="text-sm font-normal">
                                    Bond <Info className="size-4 text-muted-foreground" />
                                  </FormLabel>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>
                                    Establish a Bluetooth Classic pairing / bonding with the target
                                    device
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </FormItem>
                          );
                        }}
                      />

                      <FormField
                        control={form.control}
                        name="options"
                        render={({ field }) => {
                          return (
                            <FormItem className="flex flex-row items-center gap-2">
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.writeAccountKey}
                                  onCheckedChange={(writeAccountKey) =>
                                    field.onChange({
                                      ...field.value,
                                      writeAccountKey,
                                    })
                                  }
                                />
                              </FormControl>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <FormLabel className="text-sm font-normal">
                                    Write account key{" "}
                                    <Info className="size-4 text-muted-foreground" />
                                  </FormLabel>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Write an account key to the target device</p>
                                </TooltipContent>
                              </Tooltip>
                            </FormItem>
                          );
                        }}
                      />

                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <Button type="submit" className="mt-3" disabled={!device.modelId}>
                Submit
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Props for the attack logs component. */
interface AttackLogsProps {
  updates: ProgressUpdate[];
  updatesEndRef: React.RefObject<HTMLDivElement | null>;
}

/** Attack logs component. */
function AttackLogs({ updates, updatesEndRef }: AttackLogsProps) {
  return (
    <ScrollArea className="h-64 overflow-scroll flex flex-col font-mono border-input dark:bg-input/30 field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none md:text-sm">
      {updates.map((update) => (
        <p key={update.timestamp.getTime() + update.message}>
          [{format(update.timestamp, "kk:mm:ss:SSS")}] {update.message}
        </p>
      ))}
      <div ref={updatesEndRef} />
    </ScrollArea>
  );
}
