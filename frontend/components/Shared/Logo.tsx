import React from 'react';
import { RocketLaunchIcon } from '@heroicons/react/24/outline';

const SIZES = {
    sm: { icon: 'h-6 w-6', text: 'text-lg' },
    md: { icon: 'h-9 w-9', text: 'text-2xl' },
    lg: { icon: 'h-12 w-12', text: 'text-3xl' },
} as const;

interface LogoProps {
    size?: keyof typeof SIZES;
    className?: string;
    /** Renders just the mark, no "GoalsHQ" text — for tight spaces (e.g. a collapsed sidebar). */
    iconOnly?: boolean;
}

/**
 * The GoalsHQ wordmark — a single source of truth so every screen (Navbar,
 * Login, Register, OIDC callback, sidebar header, About) renders the same
 * mark instead of six copies of a hardcoded `<img src="wide-logo-*.png">`.
 * Ties into the same RocketLaunchIcon already used for the Strategy sidebar
 * entry, so the icon means the same thing everywhere in the app.
 */
const Logo: React.FC<LogoProps> = ({
    size = 'md',
    className = '',
    iconOnly = false,
}) => {
    const { icon, text } = SIZES[size];
    return (
        <span
            className={`inline-flex items-center gap-2 ${className}`}
            role="img"
            aria-label="GoalsHQ"
        >
            <RocketLaunchIcon
                className={`${icon} flex-shrink-0 text-blue-600 dark:text-blue-400`}
            />
            {!iconOnly && (
                <span
                    className={`${text} font-bold tracking-tight text-gray-900 dark:text-white`}
                >
                    GoalsHQ
                </span>
            )}
        </span>
    );
};

export default Logo;
