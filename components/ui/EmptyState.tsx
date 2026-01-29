import React from 'react';
import { Icon, IconName } from './Icon';
import { Button } from './Button';

interface EmptyStateProps {
    icon?: IconName;
    title: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
    className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon = IconName.Courses,
    title,
    description,
    actionLabel,
    onAction,
    className = ''
}) => {
    return (
        <div className={`flex flex-col items-center justify-center p-12 text-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 dark:bg-gray-800/50 dark:border-gray-700 ${className}`}>
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 dark:bg-gray-700">
                <Icon name={icon} className="w-8 h-8 text-gray-400 dark:text-gray-300" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1 dark:text-white">{title}</h3>
            {description && (
                <p className="text-gray-500 max-w-sm mb-6 dark:text-gray-400">{description}</p>
            )}
            {actionLabel && onAction && (
                <Button onClick={onAction} variant="primary">
                    {actionLabel}
                </Button>
            )}
        </div>
    );
};
