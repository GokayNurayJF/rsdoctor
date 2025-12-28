import { SDK } from '@rsdoctor/types';
import {
  MinusCircleOutlined,
  PlusCircleOutlined,
  RightSquareOutlined,
  FolderOpenTwoTone,
  FolderTwoTone,
} from '@ant-design/icons';
import {
  Col,
  Empty,
  Popover,
  Row,
  Space,
  Typography,
  Switch,
  Select,
} from 'antd';
import React, {
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useState,
} from 'react';
import Tree, { DefaultNodeProps, useTreeState } from 'react-hyper-tree';
import { formatSize, getShortPath } from '../../utils';
import { getFileCom } from 'src/components/FileTree';
import { ModuleGraphListContext } from '../BundleSize/config';
import { NewTreeNodeType } from './utils/hooks';
import './index.sass';
import { clsNamePrefix } from './constants';
import { Size } from 'src/constants';
import './components/fileTreeCom.scss';

const prefix = 'file-tree-com';

// Extended node type with numeric size for calculations
type TreeNodeWithNumericSize = NewTreeNodeType & {
  _numericSize?: number; // Internal field for numeric size
};

// Helper function to calculate size from children nodes (using numeric sizes)
function calculateSizeFromChildren(
  children: TreeNodeWithNumericSize[],
): number {
  return children.reduce((sum, child) => {
    return sum + (child._numericSize || 0);
  }, 0);
}

// Helper function to build folder tree structure from modules
function buildBoundModulesTree(
  modules: SDK.ModuleData[],
  allModules: SDK.ModuleData[],
  cwd: string,
  parentPath: string = '',
  level: number = 0,
): TreeNodeWithNumericSize[] {
  if (!modules || modules.length === 0) {
    return [];
  }

  // Organize modules by their immediate parent directory
  const folderMap = new Map<string, SDK.ModuleData[]>();
  const directModules: SDK.ModuleData[] = [];
  const normalizedParentPath = parentPath.replace(/\\/g, '/');

  modules.forEach((module) => {
    const pathParts = module.path.split(/[\\/]/).filter(Boolean);
    const dirParts = pathParts.slice(0, -1);
    const moduleDir = dirParts.join('/').replace(/\\/g, '/');

    if (moduleDir === normalizedParentPath) {
      // This module is directly in the current folder
      directModules.push(module);
    } else if (normalizedParentPath === '') {
      // We're at root, check if this module is in a subfolder
      const firstDir = dirParts[0] || '';
      if (firstDir) {
        const existing = folderMap.get(firstDir) || [];
        existing.push(module);
        folderMap.set(firstDir, existing);
      } else {
        directModules.push(module);
      }
    } else if (moduleDir.startsWith(normalizedParentPath + '/')) {
      // This module is in a subfolder
      const relativePath = moduleDir.slice(normalizedParentPath.length + 1);
      const nextFolder = relativePath.split('/')[0];
      const existing = folderMap.get(nextFolder) || [];
      existing.push(module);
      folderMap.set(nextFolder, existing);
    }
  });

  const result: NewTreeNodeType[] = [];

  // Add direct modules (files in current folder)
  directModules.forEach((module) => {
    const node: TreeNodeWithNumericSize = {
      __RESOURCEPATH__: module.path,
      id: module.id,
      key: `module-${module.id}`,
      name: `${getShortPath(module.path)} (${formatSize(module.size.sourceSize)})`,
      level,
      kind: module.kind,
      size: formatSize(module.size.sourceSize),
      _numericSize: module.size.sourceSize,
      concatModules: module.concatenationModules,
      chunks: module.chunks,
      dependencies: module.dependencies,
      children: [],
    };
    result.push(node);
  });

  // Add subfolders
  const sortedFolders = Array.from(folderMap.keys()).sort();
  sortedFolders.forEach((folderName) => {
    const folderModules = folderMap.get(folderName)!;
    const folderPath = normalizedParentPath
      ? `${normalizedParentPath}/${folderName}`
      : folderName;

    // Build children first to calculate size
    const children = buildBoundModulesTree(
      folderModules,
      allModules,
      cwd,
      folderPath,
      level + 1,
    );
    // Calculate folder size by summing children
    const folderSize = calculateSizeFromChildren(children);

    const folderNode: TreeNodeWithNumericSize = {
      __RESOURCEPATH__: folderPath,
      id: -1, // Folder nodes don't have module IDs
      key: `folder-${folderPath}`,
      name: `${folderName} (${formatSize(folderSize)})`,
      level,
      kind: 0,
      size: formatSize(folderSize),
      _numericSize: folderSize,
      concatModules: undefined,
      children: [],
      getChildren: () => children,
    };
    result.push(folderNode);
  });

  return result;
}

// Helper function to sort nodes
function sortNodes(
  nodes: TreeNodeWithNumericSize[],
  sortBy: 'name' | 'size',
): TreeNodeWithNumericSize[] {
  const sorted = [...nodes].sort((a, b) => {
    if (sortBy === 'name') {
      const nameA = a.name.split(' (')[0].toLowerCase();
      const nameB = b.name.split(' (')[0].toLowerCase();
      return nameA.localeCompare(nameB);
    } else {
      // Sort by size (descending)
      const sizeA = a._numericSize || 0;
      const sizeB = b._numericSize || 0;
      return sizeB - sizeA;
    }
  });

  // Recursively sort children
  return sorted.map((node) => {
    if (node.getChildren) {
      const children = node.getChildren() as TreeNodeWithNumericSize[];
      const sortedChildren = sortNodes(children, sortBy);
      return {
        ...node,
        getChildren: () => sortedChildren,
      };
    }
    return node;
  });
}

// Helper function to squash folders (combine folders that only have one subfolder)
function squashFolders(
  nodes: TreeNodeWithNumericSize[],
  allModules: SDK.ModuleData[],
): TreeNodeWithNumericSize[] {
  return nodes.map((node) => {
    // Only process folders (those with getChildren function)
    if (node.getChildren) {
      const children = node.getChildren() as TreeNodeWithNumericSize[];
      const squashedChildren = squashFolders(children, allModules);

      // If folder has exactly one child and that child is also a folder, squash them
      if (squashedChildren && squashedChildren.length === 1) {
        const child = squashedChildren[0];
        // Check if child is a folder (id === -1 or has getChildren)
        if (child.id === -1 || child.getChildren) {
          // Squash: combine the folder names
          const parentName = node.name.split(' (')[0]; // Get name without size
          const childName = child.name.split(' (')[0]; // Get name without size
          const combinedName = `${parentName}/${childName}`;

          // Use child's numeric size (which should already be correct)
          const childNumericSize = child._numericSize || 0;

          // Create new squashed node
          const squashedNode: TreeNodeWithNumericSize = {
            ...child,
            key: `folder-${child.__RESOURCEPATH__}`,
            name: `${combinedName} (${formatSize(childNumericSize)})`,
            size: formatSize(childNumericSize),
            _numericSize: childNumericSize,
            level: node.level,
            // Recursively squash children
            getChildren: child.getChildren
              ? () => {
                  const grandChildren =
                    child.getChildren!() as TreeNodeWithNumericSize[];
                  return squashFolders(grandChildren, allModules);
                }
              : undefined,
          };

          return squashedNode;
        }
      }

      // Recalculate size for this folder based on its children's numeric sizes
      const folderSize = calculateSizeFromChildren(squashedChildren);
      const folderName = node.name.split(' (')[0];

      // Recursively squash children
      return {
        ...node,
        name: `${folderName} (${formatSize(folderSize)})`,
        size: formatSize(folderSize),
        _numericSize: folderSize,
        getChildren: () => {
          return squashedChildren;
        },
      };
    }

    return node;
  });
}

const BoundModulesTree: React.FC<{
  boundModules: SDK.ModuleData[];
  allModules: SDK.ModuleData[];
  boundSize: string;
  cwd: string;
}> = ({ boundModules, allModules, cwd }) => {
  const [showBoundOnly, setShowBoundOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'size'>('name');

  const displayedModules = showBoundOnly ? boundModules : allModules;

  const treeData = useMemo(() => {
    const tree = buildBoundModulesTree(
      displayedModules,
      displayedModules,
      cwd,
      '',
      0,
    );
    const squashed = squashFolders(tree, displayedModules);
    return sortNodes(squashed, sortBy);
  }, [displayedModules, cwd, sortBy]);

  const { required, handlers } = useTreeState({
    id: `${prefix}-bound-modules-tree`,
    data: treeData || [],
    defaultOpened: false,
    multipleSelect: false,
    refreshAsyncNodes: true,
  });

  const expandedNodes = useRef<Set<string | number>>(new Set());

  useEffect(() => {
    expandedNodes.current.clear();
  }, [treeData]);

  const renderNode = useCallback(
    ({ node, onToggle }: DefaultNodeProps) => {
      if (
        typeof node.data !== 'object' ||
        node.data === null ||
        Array.isArray(node.data)
      ) {
        return null;
      }

      const hasChildren =
        typeof node.data.getChildren === 'function' ||
        (Array.isArray(node.data.children) && node.data.children.length > 0);

      // Determine if this is a folder (id === -1) or a file
      const isFolder = node.data.id === -1;

      // Get appropriate icon
      const Icon = isFolder ? (
        node.options.opened ? (
          <FolderOpenTwoTone />
        ) : (
          <FolderTwoTone />
        )
      ) : (
        getFileCom(node.data.__RESOURCEPATH__ || node.data.name)
      );

      return (
        <div className={`${prefix}-titles-box`} key={node.data.name}>
          <div className={`${prefix}-titles`}>
            <Space direction="vertical">
              <div className={`${prefix}-node-title`}>
                <Space>
                  <div onClick={onToggle}>
                    <Space>
                      {(() => {
                        return !node.options.opened && hasChildren ? (
                          <PlusCircleOutlined style={{ color: 'lightblue' }} />
                        ) : (
                          <MinusCircleOutlined style={{ color: 'lightblue' }} />
                        );
                      })()}
                      {Icon}
                      <Popover
                        key={`${node.data.name}popover`}
                        content={
                          <>
                            {node.data.__RESOURCEPATH__ ? (
                              <Typography.Text
                                key={`${node.data.name}-popover-path`}
                                code
                              >
                                {node.data.__RESOURCEPATH__}
                              </Typography.Text>
                            ) : (
                              <></>
                            )}
                            {node.data.size && (
                              <Typography.Text
                                key={`${node.data.name}-popover-size`}
                                style={{ display: 'block', marginTop: 8 }}
                              >
                                Size: {node.data.size}
                              </Typography.Text>
                            )}
                          </>
                        }
                        title="INFO"
                        trigger="hover"
                      >
                        <Typography.Text>{node.data.name}</Typography.Text>
                      </Popover>
                    </Space>
                  </div>
                  <Space>
                    {node.data.id && node.data.id > 0 && (
                      <ModuleGraphListContext.Consumer>
                        {({ moduleJumpList, setModuleJumpList }) => {
                          return (
                            <RightSquareOutlined
                              onClick={() => {
                                const _list = [...moduleJumpList];
                                _list.push(+node.data.id);
                                setModuleJumpList(_list);
                              }}
                            />
                          );
                        }}
                      </ModuleGraphListContext.Consumer>
                    )}
                  </Space>
                </Space>
              </div>
            </Space>
          </div>
        </div>
      );
    },
    [handlers],
  );

  const totalSize = useMemo(() => {
    return displayedModules.reduce((sum, m) => sum + m.size.sourceSize, 0);
  }, [displayedModules]);

  return (
    <div
      className={`${clsNamePrefix}-file-tree`}
      style={{ padding: Size.BasePadding / 2 }}
    >
      {/* Controls Section */}
      <Row style={{ marginBottom: Size.BasePadding }} gutter={[16, 8]}>
        <Col span={24}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <Typography.Text strong>Show:</Typography.Text>
                <Switch
                  checkedChildren="Bound"
                  unCheckedChildren="All"
                  checked={showBoundOnly}
                  onChange={setShowBoundOnly}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {showBoundOnly ? 'Bound Dependencies' : 'All Dependencies'}
                </Typography.Text>
              </Space>
              <Space>
                <Typography.Text strong>Sort by:</Typography.Text>
                <Select
                  value={sortBy}
                  onChange={setSortBy}
                  style={{ width: 120 }}
                  size="small"
                  options={[
                    { label: 'Name', value: 'name' },
                    { label: 'Size', value: 'size' },
                  ]}
                />
              </Space>
            </Space>
            <Space>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Count: {displayedModules.length} modules
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Total Size: {formatSize(totalSize)}
              </Typography.Text>
            </Space>
          </Space>
        </Col>
      </Row>

      {/* Tree Section */}
      <Row justify="start" align="middle">
        <Col span={24}>
          {treeData.length ? (
            <Tree
              {...required}
              {...handlers}
              horizontalLineStyles={{
                stroke: '#c4c4c4',
                strokeWidth: 2,
                strokeDasharray: '1 1',
              }}
              verticalLineStyles={{
                stroke: '#c4c4c4',
                strokeWidth: 2,
                strokeDasharray: '1 1',
              }}
              draggable={false}
              depthGap={14}
              gapMode={'padding'}
              disableLines={false}
              disableTransitions={true}
              disableHorizontalLines={false}
              disableVerticalLines={false}
              verticalLineTopOffset={0}
              verticalLineOffset={5}
              renderNode={renderNode}
            />
          ) : (
            <Empty />
          )}
        </Col>
      </Row>
    </div>
  );
};

export default BoundModulesTree;
