import React from 'react';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';

export interface NavBoxProps {
    title: string;
    description: string;
    icon: IconName;
    onClick: () => void;
    className?: string;
}

export const NavBox: React.FC<NavBoxProps> = ({
    title,
    description,
    icon,
    onClick,
    className = ''
}) => {
    return (
        <Card
            className={`p-6 cursor-pointer hover:shadow-lg transition-shadow duration-200 border-2 hover:border-blue-300 dark:bg-gray-800 dark:border-gray-700 dark:hover:border-blue-500 ${className}`}
            onClick={onClick}
        >
            <div className="flex flex-col items-center text-center">
                <div className="mb-4 p-3 bg-info-bg rounded-full">
                    <Icon
                        name={icon}
                        className="w-8 h-8 text-primary"
                    />
                </div>
                <h3 className="text-lg font-semibold text-on-surface mb-2">
                    {title}
                </h3>
                <p className="text-sm text-on-surface-secondary leading-relaxed">
                    {description}
                </p>
            </div>
        </Card>
    );
};