import { Card } from "./ui/card";

const CharacteristicsMap: any = {
  "fe2c1233-8366-4814-8eb0-01de32100bea": "Model ID",
  "fe2c1234-8366-4814-8eb0-01de32100bea": "Key-based pairing",
  "fe2c1235-8366-4814-8eb0-01de32100bea": "Passkey",
  "fe2c1236-8366-4814-8eb0-01de32100bea": "Account key",
  "fe2c1237-8366-4814-8eb0-01de32100bea": "Additional data",
  "fe2c1238-8366-4814-8eb0-01de32100bea": "FHN Beacon actions",
  "fe2c1239-8366-4814-8eb0-01de32100bea": "Message Stream PSM",
};

/** Props for the Characteristics component. */
interface CharacteristicsProps {
  characteristics?: string[];
}

/** A list of characteristics. */
export default function Characteristics({ characteristics }: CharacteristicsProps) {
  return (
    <Card className="mt-2 py-2 px-3 min-h-50">
      <div>
        {characteristics?.map((c) => (
          <div key={c} className="flex flex-col">
            <span>{CharacteristicsMap[c] || "Unknown characteristic"}</span>
            <span className="text-xs text-muted-foreground">{c}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
