// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "ajisai",
    products: [
        .executable(
            name: "ajisai",
            targets: ["Ajisai"]),
        .library(
            name: "AjisaiUtil",
            targets: ["AjisaiUtil"]),
        .library(
            name: "AjisaiParser",
            targets: ["AjisaiParser"]),
        .library(
            name: "AjisaiSemanticAnalyzer",
            targets: ["AjisaiSemanticAnalyzer"]),
        .library(
            name: "AjisaiCodeGenerator",
            targets: ["AjisaiCodeGenerator"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.3.0")
    ],
    targets: [
        .executableTarget(
            name: "Ajisai",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
                "AjisaiParser",
                "AjisaiSemanticAnalyzer",
                "AjisaiCodeGenerator",
            ]),
        .target(
            name: "AjisaiUtil"),
        .target(
            name: "AjisaiParser"),
        .target(
            name: "AjisaiSemanticAnalyzer",
            dependencies: ["AjisaiParser", "AjisaiUtil"]),
        .target(
            name: "AjisaiCodeGenerator",
            dependencies: ["AjisaiSemanticAnalyzer", "AjisaiUtil"]),
        // Tests
        .testTarget(
            name: "AjisaiParserTests",
            dependencies: ["AjisaiParser"]),
        .testTarget(
            name: "AjisaiSemanticAnalyzerTests",
            dependencies: ["AjisaiParser", "AjisaiSemanticAnalyzer", "AjisaiUtil"]),
    ]
)
