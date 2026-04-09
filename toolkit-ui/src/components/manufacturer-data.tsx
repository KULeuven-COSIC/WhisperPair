import { DeviceData } from "./device";

interface ManufacturerDataProps {
  data: DeviceData["manufacturerData"];
}

/** Manufacturer data. */
export default function ManufacturerData({ data }: ManufacturerDataProps) {
  if (!Object.keys(data).length) return <div>No data available</div>;

  return (
    <div>
      {data.map(({ identifier, name, value }) => (
        <div key={identifier}>
          {name} <span className="text-muted-foreground">(0x{parseInt(value).toString(16)})</span>
          <div className="text-sm font-mono">{value}</div>
        </div>
      ))}
    </div>
  );
}
