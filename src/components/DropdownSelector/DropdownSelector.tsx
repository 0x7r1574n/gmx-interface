import { Listbox } from "@headlessui/react";
import cx from "classnames";
import { BiChevronDown } from "react-icons/bi";

type Primitive = string | number;
type WithConditionalItemKey<Id extends Primitive, Option> = Id extends Primitive
  ? { itemKey?: (option: Option) => Id }
  : { itemKey: (option: Option) => Id };

export const DropdownSelector = <Id extends Primitive, Option>({
  value,
  onChange,
  button,
  options,
  item: Item,
  itemKey,
  placeholder,
  slim = false,
  elevated = false,
}: {
  value: Id | undefined;
  onChange: (value: Id) => void;
  button: React.JSX.Element | undefined;
  options: Option[];
  item: ({ option }: { option: Option }) => React.JSX.Element;
  placeholder?: string;
  slim?: boolean;
  elevated?: boolean;
} & WithConditionalItemKey<Id, Option>) => {
  return (
    <Listbox value={value ?? null} onChange={onChange}>
      <div className="relative">
        <Listbox.Button
          className={cx(
            "flex w-full items-center justify-between rounded-4",
            slim ? "text-body-medium p-4" : "text-body-large px-14 py-12",
            elevated
              ? "bg-cold-blue-700 active:bg-cold-blue-500 gmx-hover:bg-cold-blue-500"
              : "bg-cold-blue-900 active:bg-cold-blue-500 gmx-hover:bg-cold-blue-700"
          )}
        >
          {value === undefined ? <div className="text-slate-100">{placeholder}</div> : button}
          <BiChevronDown className="size-20 text-slate-100" />
        </Listbox.Button>
        <Listbox.Options
          className={cx(
            "absolute left-0 right-0 top-full z-10 mt-4 overflow-auto rounded-4 px-0",
            slim ? "" : "py-8",
            elevated ? "bg-cold-blue-700" : "border border-slate-600 bg-slate-700"
          )}
        >
          {options.map((option) => (
            <Listbox.Option
              key={itemKey ? itemKey(option) : (option as Primitive)}
              value={itemKey ? itemKey(option) : (option as Primitive)}
              className={({ active, selected }) =>
                cx(
                  "cursor-pointer",
                  slim ? "text-body-medium p-4" : "text-body-large px-14 py-8",
                  (active || selected) && (elevated ? "bg-cold-blue-500" : "bg-slate-600")
                )
              }
            >
              <Item option={option} />
            </Listbox.Option>
          ))}
        </Listbox.Options>
      </div>
    </Listbox>
  );
};
