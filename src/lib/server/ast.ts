import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

export type SmartDiffStatus = 'modified' | 'added' | 'removed';

export type ExtractedBlock = {
	key: string;
	name: string;
	signature: string;
	kind: 'function' | 'class';
	code: string;
	startIndex: number;
	endIndex: number;
};

export type SmartDiffEntry = {
	fileName: string;
	methodName: string;
	oldCode: string | null;
	newCode: string | null;
	status: SmartDiffStatus;
};

const parser = new Parser();
const pythonLanguage = Python as unknown as Parser.Language;
parser.setLanguage(pythonLanguage);

const getNodeText = (node: Parser.SyntaxNode, source: string) =>
	source.slice(node.startIndex, node.endIndex);

const getFieldText = (node: Parser.SyntaxNode | null, source: string) =>
	node ? getNodeText(node, source) : '';

const buildFunctionSignature = (node: Parser.SyntaxNode, source: string) => {
	const name = getFieldText(node.childForFieldName('name'), source) || 'anonymous';
	const parameters = getFieldText(node.childForFieldName('parameters'), source);
	return `def ${name}${parameters || '()'}`;
};

const buildClassSignature = (node: Parser.SyntaxNode, source: string) => {
	const name = getFieldText(node.childForFieldName('name'), source) || 'AnonymousClass';
	const superclasses = getFieldText(node.childForFieldName('superclasses'), source);
	return superclasses ? `class ${name}${superclasses}` : `class ${name}`;
};

const normalizeCode = (code: string) => code.replace(/\s+$/u, '');

export const extractPythonBlocks = (source: string) => {
	const tree = parser.parse(source);
	const blocks = new Map<string, ExtractedBlock>();
	const classStack: string[] = [];

	const visit = (node: Parser.SyntaxNode) => {
		if (node.type === 'class_definition') {
			const signature = buildClassSignature(node, source);
			const name = getFieldText(node.childForFieldName('name'), source) || 'AnonymousClass';
			const keyPrefix = classStack.length ? `${classStack.join('.')}.` : '';
			const key = `${keyPrefix}${signature}`;
			blocks.set(key, {
				key,
				name,
				signature,
				kind: 'class',
				code: getNodeText(node, source),
				startIndex: node.startIndex,
				endIndex: node.endIndex
			});

			classStack.push(name);
			for (const child of node.namedChildren) {
				visit(child);
			}
			classStack.pop();
			return;
		}

		if (node.type === 'function_definition') {
			const signature = buildFunctionSignature(node, source);
			const name = getFieldText(node.childForFieldName('name'), source) || 'anonymous';
			const keyPrefix = classStack.length ? `${classStack.join('.')}.` : '';
			const key = `${keyPrefix}${signature}`;
			blocks.set(key, {
				key,
				name,
				signature,
				kind: 'function',
				code: getNodeText(node, source),
				startIndex: node.startIndex,
				endIndex: node.endIndex
			});
		}

		for (const child of node.namedChildren) {
			visit(child);
		}
	};

	visit(tree.rootNode);
	return blocks;
};

export const diffPythonBlocks = (
	fileName: string,
	oldBlocks: Map<string, ExtractedBlock>,
	newBlocks: Map<string, ExtractedBlock>
) => {
	const entries: SmartDiffEntry[] = [];
	const keys = new Set([...oldBlocks.keys(), ...newBlocks.keys()]);

	for (const key of keys) {
		const oldBlock = oldBlocks.get(key);
		const newBlock = newBlocks.get(key);

		if (oldBlock && newBlock) {
			if (normalizeCode(oldBlock.code) !== normalizeCode(newBlock.code)) {
				entries.push({
					fileName,
					methodName: key,
					oldCode: oldBlock.code,
					newCode: newBlock.code,
					status: 'modified'
				});
			}
			continue;
		}

		if (!oldBlock && newBlock) {
			entries.push({
				fileName,
				methodName: key,
				oldCode: null,
				newCode: newBlock.code,
				status: 'added'
			});
			continue;
		}

		if (oldBlock && !newBlock) {
			entries.push({
				fileName,
				methodName: key,
				oldCode: oldBlock.code,
				newCode: null,
				status: 'removed'
			});
		}
	}

	return entries;
};
