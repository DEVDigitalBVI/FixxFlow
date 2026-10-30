import { NativeSelect } from '@/components/ui/input';

export function TimezoneSelect({
  value,
  personal = false,
  label,
}: {
  value: string;
  personal?: boolean;
  label?: string;
}) {
  const zones = Array.from(
    new Set(['UTC', ...Intl.supportedValuesOf('timeZone'), ...(value ? [value] : [])]),
  ).sort();
  return (
    <label className="field">
      {label ?? (personal ? 'Display timezone' : 'Organization timezone')}
      <NativeSelect name="timezone" defaultValue={value} required={!personal}>
        {personal && <option value="">Follow my device</option>}
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replaceAll('_', ' ')}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
