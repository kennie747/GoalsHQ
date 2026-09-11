import React, { useState } from 'react';

/**
 * Progressive-disclosure field bar — the pattern from ProjectModal.tsx.
 * Only name + description (or whatever the caller renders above) show by
 * default; each optional field sits behind an icon toggle and reveals its
 * control inline. A filled field gets a dot badge on its icon.
 */
export interface CollapsibleField {
    key: string;
    /** heroicon (or any node) shown in the toggle button */
    icon: React.ReactNode;
    label: string;
    /** true → show the green dot badge (field has a value) */
    filled?: boolean;
    /** the control to render when this section is expanded */
    render: () => React.ReactNode;
    /** start expanded (e.g. the user just clicked "edit projects") */
    defaultOpen?: boolean;
}

interface Props {
    fields: CollapsibleField[];
    className?: string;
}

const CollapsibleFields: React.FC<Props> = ({ fields, className = '' }) => {
    const [open, setOpen] = useState<Set<string>>(
        () => new Set(fields.filter((f) => f.defaultOpen).map((f) => f.key))
    );

    const toggle = (key: string) =>
        setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    return (
        <div className={className}>
            {fields.map(
                (f) =>
                    open.has(f.key) && (
                        <div key={f.key} className="px-1 pb-3">
                            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                {f.label}
                            </div>
                            {f.render()}
                        </div>
                    )
            )}
            <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 pt-2 dark:border-gray-700">
                {fields.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        title={f.label}
                        aria-label={f.label}
                        aria-pressed={open.has(f.key)}
                        onClick={() => toggle(f.key)}
                        className={`relative rounded-full p-2 transition-colors ${
                            open.has(f.key)
                                ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300'
                                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                        }`}
                    >
                        <span className="block h-5 w-5">{f.icon}</span>
                        {f.filled && (
                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500 dark:border-gray-800" />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default CollapsibleFields;
