import React from 'react';
import { Link } from 'react-router-dom';
import Logo from '../Shared/Logo';

const SidebarHeader: React.FC = () => {
    return (
        <div className="flex justify-center mb-6 mt-2">
            <Link
                to="/"
                className="flex justify-center items-center mb-2 no-underline"
            >
                <Logo size="lg" />
            </Link>
        </div>
    );
};

export default SidebarHeader;
