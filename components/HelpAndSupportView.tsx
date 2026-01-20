import React from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';

const InfoItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div>
        <p className="text-sm font-semibold text-subtle">{label}</p>
        <p className="text-on-surface">{value}</p>
    </div>
);

const HelpAndSupportView: React.FC = () => {
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">Help & Support</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                {/* Left Column: Contact Info */}
                <div className="lg:col-span-1">
                    <Card className="p-6">
                        <h3 className="text-xl font-bold mb-4">Contact Information</h3>
                        <div className="space-y-4">
                            <InfoItem label="Company Address" value="12 Woodland Square #07-85/86/87 Woods Square Tower 1, Singapore 737715" />
                            <InfoItem label="Opening Hours" value="Mon - Fri, 9:00 AM - 6:00 PM" />
                            <InfoItem label="Hotline Tel" value="61234567" />
                            <InfoItem label="Support Email" value="support@tertiary-lms.com" />
                        </div>
                    </Card>
                </div>

                {/* Right Column: Ticketing */}
                <div className="lg:col-span-2">
                    <Card className="p-6">
                        <h3 className="text-xl font-bold mb-4">All Tickets</h3>
                        <div className="text-center py-12 px-6 bg-gray-50 rounded-lg">
                            <Icon name={IconName.Chat} className="w-24 h-24 mx-auto mb-6 text-primary" />
                            <h4 className="text-xl font-bold text-on-surface">Need assistance?</h4>
                            <p className="mt-1 font-semibold text-on-surface">Go ahead and raise your first ticket</p>
                            <p className="mt-2 text-subtle max-w-md mx-auto">
                                Our team will address any issues related to the course, connectivity, sessions, payments and more. Raise issue
                            </p>
                            <Button className="mt-6 !bg-gray-800 hover:!bg-gray-900">
                                Raise a New Ticket
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default HelpAndSupportView;