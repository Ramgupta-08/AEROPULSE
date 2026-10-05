import * as Sw from "@radix-ui/react-switch";

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-body">
      <Sw.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-border bg-raised transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <Sw.Thumb className="block h-3.5 w-3.5 translate-x-[1px] rounded-full bg-strong transition-transform duration-150 data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-white" />
      </Sw.Root>
      {label}
    </label>
  );
}
