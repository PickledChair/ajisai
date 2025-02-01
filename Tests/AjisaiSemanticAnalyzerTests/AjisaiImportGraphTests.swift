import AjisaiParser
import AjisaiSemanticAnalyzer
import Foundation
import Testing

struct AjisaiImportGraphTest {
    enum ImportGraphStructure {
        case leaf(name: String)
        case tree(name: String, childs: [ImportGraphStructure])

        func hasSameStructure(with importGraph: AjisaiImportGraphNode<AjisaiModuleNode>) -> Bool {
            switch self {
            case let .leaf(name: name):
                guard importGraph.importMods.isEmpty else {
                    return false
                }
                return importGraph.modName.orig == name
            case let .tree(name: name, childs: childs):
                guard importGraph.importMods.count == childs.count else {
                    return false
                }
                for (child, importMod) in zip(childs, importGraph.importMods) {
                    guard child.hasSameStructure(with: importMod.node) else {
                        return false
                    }
                }
                return importGraph.modName.orig == name
            }
        }
    }

    func testTemplate(srcName: String, srcContent: String, expectedStructure: ImportGraphStructure)
    {
        let lexer = AjisaiLexer(
            srcURL: URL(filePath: "\(srcName).ajs"), srcContent: srcContent)
        let parser = AjisaiParser(lexer: lexer)
        switch parser.parse() {
        case let .failure(error):
            #expect(Bool(false), "error: \(error)")
        case let .success(dec):
            switch makeImportGraph(modDeclare: dec) {
            case let .failure(error):
                #expect(Bool(false), "error: \(error)")
            case let .success(importGraph):
                #expect(expectedStructure.hasSameStructure(with: importGraph))
            }
        }
    }

    @Test("making import graph with super and package module test")
    func importSuperAndPackageTest() {
        let srcName = "super_and_package_module"
        let source = """
            module a {
                module b {
                    import super::c;

                    func hello() {
                        c::hello()
                    }
                }

                module c {
                    import package::d;

                    func hello() {
                        d::hello()
                    }
                }
            }

            module d {
                func hello() {
                    println_str("hello")
                }
            }

            import a::b;

            b::hello();
            """
        let structure = ImportGraphStructure.tree(
            name: srcName,
            childs: [.tree(name: "b", childs: [.tree(name: "c", childs: [.leaf(name: "d")])])])
        testTemplate(srcName: srcName, srcContent: source, expectedStructure: structure)
    }

    @Test("making import graph with submodules test")
    func submoduleTest() {
        let srcName = "submodule"
        let source = """
            module arith {
                func add(a: i32, b: i32) -> i32 { a + b }
                func sub(a: i32, b: i32) -> i32 { a - b }
                func mul(a: i32, b: i32) -> i32 { a * b }
                func div(a: i32, b: i32) -> i32 { a / b }

                module deep_thought {
                    val answer: i32 = 21 * 2;
                }
            }

            module a {
                val hello: str = "hello1";
                module a {
                    val hello: str = "hello2";
                    module a {
                        val hello: str = "hello3";
                    }
                }
            }

            import arith;
            import arith::deep_thought;
            import a as a1;
            import a::a as a2;
            import a::a::a as a3;

            func main() {
                println_i32(arith::add(10, 5));
                println_i32(arith::sub(10, 5));
                println_i32(arith::mul(10, 5));
                println_i32(arith::div(10, 5));
                println_i32(deep_thought::answer);

                println_str(a1::hello);
                println_str(a2::hello);
                println_str(a3::hello);
            }

            main();
            """
        let structure = ImportGraphStructure.tree(
            name: srcName,
            childs: [
                .leaf(name: "arith"), .leaf(name: "deep_thought"), .leaf(name: "a"),
                .leaf(name: "a"), .leaf(name: "a"),
            ])
        testTemplate(srcName: srcName, srcContent: source, expectedStructure: structure)
    }
}
