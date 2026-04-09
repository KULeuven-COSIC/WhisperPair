import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isFastPairService(uuid: string) {
  return uuid == "0000fe2c-0000-1000-8000-00805f9b34fb";
}
