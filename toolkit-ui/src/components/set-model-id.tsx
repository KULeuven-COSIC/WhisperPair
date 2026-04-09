"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import LoadingDialog from "./loading-dialog";
import { useForm } from "react-hook-form";
import { socket } from "@/lib/socket";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import React from "react";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formSchema = z.object({
  modelId: z
    .string()
    .min(1)
    .refine((value) => isFinite(Number(value)), {
      error: "Model ID should be a number",
    }),
});

export const knownModelIds = {
  "Beats Solo Buds": 6980580,
  "Google Pixel Buds Pro 2": 12934265,
  "Jabra Elite 8 Active": 3778746,
  "JBL Tune beam": 3293323,
  "MOTIF II A.N.C.": 15473012,
  "Nothing ear(a)": 8625818,
  "OnePlus Nord Buds Pro 3": 13394952,
  "Poly VFree 60 Series": 15984097,
  "Redmi Buds 5 Pro": 11155060,
  "soundcore Liberty 4 NC": 5409858,
  "WF-1000XM5": 12499626,
  "Sony WH-1000XM4": 13386638,
  "Sony WH-1000XM5": 13911719,
  "Sony WH-1000XM6": 6360443,
  "Sony WH-CH720N": 16003068,
  "ATH-M20xBT": 13285048,
  "Bose QC Ultra Headphones": 5723549,
  "JBL Live 775NC ": 14502233,
  "Marshall Major V": 12915160,
  "Sonos Ace": 7340495,
  "Beosound A1 2nd Gen": 2431472,
  "Jabra Speak2 55 UC": 9888885,
  "JBL Clip 5": 1917389,
  "JBL Flip 6": 7278954,
  "WONDERBOOM 4": 11575855,
};

interface SetModelIdProps {
  address: string;
  hasCurrentTask?: boolean;
}

/** Set model id dialog. */
export default function SetModelId({ address, hasCurrentTask }: SetModelIdProps) {
  const [showDialog, setShowDialog] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      modelId: "",
    },
  });

  const modelId = form.watch("modelId");

  function onSubmit(values: z.infer<typeof formSchema>) {
    setShowDialog(false);
    setIsLoading(true);

    socket.emit("saveModelId", address, Number(values.modelId), () => setIsLoading(false));
  }

  const deviceSelectValue = React.useMemo(() => {
    const number = Number(modelId);
    if (!isFinite(number)) return "custom";

    const match = Object.values(knownModelIds).find((id) => id === number);
    if (!match) return "custom";

    return match.toString();
  }, [modelId]);

  function handleDeviceSelectChange(value: string) {
    form.setValue("modelId", value == "custom" ? "" : value);
  }

  return (
    <>
      <LoadingDialog open={isLoading} />
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogTrigger asChild>
          <Button size="sm" variant="secondary" disabled={hasCurrentTask}>
            Set Model ID
          </Button>
        </DialogTrigger>

        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set custom model ID</DialogTitle>
            <DialogDescription>Set a custom model ID for this device.</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
              <FormField
                control={form.control}
                name="modelId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model ID</FormLabel>
                    <FormControl>
                      <Input placeholder="0x012345" {...field} />
                    </FormControl>
                    <FormDescription>The new model ID for this device.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-2">
                <Label>Device</Label>
                <Select value={deviceSelectValue} onValueChange={handleDeviceSelectChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Custom" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(knownModelIds).map(([name, id]) => (
                      <SelectItem key={id} value={id.toString()}>
                        {name} <span className="text-muted-foreground">({id})</span>
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">Load the model ID from a device.</p>
              </div>

              <Button type="submit">Submit</Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
