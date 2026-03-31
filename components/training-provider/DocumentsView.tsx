import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const DocumentsView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white">Documents</h3>
        <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
          Download templates and other important documents.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col">
          <div className="p-6 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center">
                <Icon name={IconName.FilePdf} className="w-7 h-7" />
              </div>
            </div>
            <h4 className="text-lg font-semibold mb-2">Certificate Template</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Standard certificate template.
            </p>
            <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
              <a 
                href="/certificate_template/Certificate Template.pdf"
                download
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex justify-center items-center gap-2 px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition"
              >
                <Icon name={IconName.Download} className="w-4 h-4" />
                Download Template
              </a>
              <a 
                href="/certificate_template/Certificate Template Blank.pdf"
                download
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex justify-center items-center gap-2 px-4 py-2 border shadow-sm text-sm font-medium rounded-md text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 border-blue-200 dark:border-blue-800 transition"
              >
                <Icon name={IconName.Download} className="w-4 h-4" />
                Download Blank Version
              </a>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default DocumentsView;
