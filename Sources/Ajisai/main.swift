import AjisaiCodeGenerator
import AjisaiParser
import AjisaiSemanticAnalyzer
import ArgumentParser
import Foundation

enum AjisaiError: Error {
    case could_not_read_srcContent_as_utf8_string
    case dest_dir_path_is_file
}

struct FileOutputStream: TextOutputStream {
    var fileHandle: FileHandle

    init(fileHandle: FileHandle) {
        self.fileHandle = fileHandle
    }

    public mutating func write(_ string: String) {
        fileHandle.write(Data(string.utf8))
    }
}

@main
struct Ajisai: ParsableCommand {
    @Argument var inputFile: String

    @Option(name: [.short, .customLong("output")])
    var outputFile: String?

    mutating func run() throws {
        let currentDirURL = URL(string: "file://\(FileManager.default.currentDirectoryPath)")!
        var inputFileURL = currentDirURL
        inputFileURL.appendPathComponent(inputFile)

        let srcData = try Data(contentsOf: inputFileURL)
        guard let srcContent = String(data: srcData, encoding: .utf8) else {
            throw AjisaiError.could_not_read_srcContent_as_utf8_string
        }

        // 構文解析
        let ast = try parseFile(srcURL: inputFileURL, srcContent: srcContent).get()

        // 意味解析
        let analyzedAst = try semanticAnalyze(modDeclare: ast).get()

        let destDirPath = "ajisai-out"
        let runtimePath = "runtime"
        var fileOutputStream = try prepareDestFile(
            destDirPath: destDirPath, runtimePath: runtimePath)

        // コード生成（C のソースコードを出力）
        codeGenerate(analyzedAst: analyzedAst, to: &fileOutputStream)

        var outputFileURL = currentDirURL
        var outputFileName = inputFileURL.lastPathComponent
        outputFileName.removeLast(inputFileURL.pathExtension.count + 1)
        outputFileURL.appendPathComponent(outputFileName)
        let outputFilePath = outputFile ?? outputFileURL.path

        // 出力した C ソースコードのコンパイル
        cc(outputFilePath: outputFilePath, destDirPath: destDirPath, runtimePath: runtimePath)

    }

    func prepareDestFile(destDirPath: String, runtimePath: String) throws -> FileOutputStream {
        var destPathIsDir = ObjCBool(false)
        var destPathAlreadyExists = false

        if FileManager.default.fileExists(atPath: destDirPath, isDirectory: &destPathIsDir) {
            destPathAlreadyExists = true
        } else {
            try FileManager.default.createDirectory(
                atPath: destDirPath, withIntermediateDirectories: false)
        }
        if destPathAlreadyExists && !destPathIsDir.boolValue {
            throw AjisaiError.dest_dir_path_is_file
        }

        // ファイルを作成して書き込み
        FileManager.default.createFile(atPath: "\(destDirPath)/main.c", contents: nil)
        let fileHandle = FileHandle(forWritingAtPath: "\(destDirPath)/main.c")!
        return FileOutputStream(fileHandle: fileHandle)
    }

    func cc(outputFilePath: String, destDirPath: String, runtimePath: String) {
        let cc = Process()
        cc.executableURL = URL(fileURLWithPath: "/usr/bin/cc")
        cc.arguments = [
            "-o", outputFilePath, "-I./\(runtimePath)", "\(destDirPath)/main.c",
            "\(runtimePath)/ajisai_runtime.c",
        ]

        let stdoutPipe = Pipe()
        cc.standardOutput = stdoutPipe
        let stderrPipe = Pipe()
        cc.standardError = stderrPipe

        cc.launch()

        let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        if let output = String(data: stdoutData, encoding: .utf8) {
            print(output, terminator: "")
        }
        let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        var stderrStream = FileOutputStream(fileHandle: FileHandle.standardError)
        if let err = String(data: stderrData, encoding: .utf8) {
            print(err, terminator: "", to: &stderrStream)
        }

    }
}
