#!/bin/bash
# Helper script for CDK operations
# Workaround for WSL path issues

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   AWS CDK Deployment Helper${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo -e "${YELLOW}Run: aws configure${NC}"
    exit 1
fi

# Show current AWS identity
echo -e "\n${GREEN}✓${NC} AWS Identity:"
aws sts get-caller-identity --query '[Account,Arn]' --output table

# Parse command
COMMAND=${1:-help}

case $COMMAND in
    synth)
        echo -e "\n${BLUE}📦 Synthesizing CDK stacks...${NC}"
        npm run build
        npx cdk synth --all
        echo -e "${GREEN}✓ Synthesis complete${NC}"
        ;;
    
    diff)
        echo -e "\n${BLUE}🔍 Showing differences from deployed stack...${NC}"
        npm run build
        npx cdk diff --all
        ;;
    
    deploy)
        STACK=${2:-all}
        echo -e "\n${BLUE}🚀 Deploying stack(s)...${NC}"
        npm run build
        
        if [ "$STACK" == "all" ]; then
            npx cdk deploy --all --require-approval never
        else
            npx cdk deploy $STACK --require-approval never
        fi
        
        echo -e "${GREEN}✓ Deployment complete${NC}"
        ;;
    
    bootstrap)
        REGION=${2:-us-east-1}
        echo -e "\n${BLUE}🔧 Bootstrapping CDK for region $REGION...${NC}"
        ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
        npx cdk bootstrap aws://$ACCOUNT/$REGION
        echo -e "${GREEN}✓ Bootstrap complete${NC}"
        ;;
    
    destroy)
        echo -e "\n${RED}⚠️  WARNING: This will destroy all resources!${NC}"
        read -p "Are you sure? (yes/no): " confirm
        if [ "$confirm" == "yes" ]; then
            npm run build
            npx cdk destroy --all --force
            echo -e "${GREEN}✓ Resources destroyed${NC}"
        else
            echo -e "${YELLOW}Cancelled${NC}"
        fi
        ;;
    
    list)
        echo -e "\n${BLUE}📋 Listing CDK stacks...${NC}"
        npm run build
        npx cdk list
        ;;
    
    test)
        echo -e "\n${BLUE}🧪 Running tests...${NC}"
        npm test
        ;;
    
    build)
        echo -e "\n${BLUE}🔨 Building TypeScript...${NC}"
        npm run build
        echo -e "${GREEN}✓ Build complete${NC}"
        ;;
    
    clean)
        echo -e "\n${BLUE}🧹 Cleaning build artifacts...${NC}"
        rm -rf node_modules cdk.out bin/*.js lib/*.js src/**/*.js test/*.js
        echo -e "${GREEN}✓ Clean complete${NC}"
        ;;
    
    install)
        echo -e "\n${BLUE}📦 Installing dependencies...${NC}"
        npm install
        echo -e "${GREEN}✓ Installation complete${NC}"
        ;;
    
    help|*)
        echo -e "\n${GREEN}Available commands:${NC}"
        echo -e "  ${BLUE}synth${NC}          - Synthesize CDK stacks (show CloudFormation)"
        echo -e "  ${BLUE}diff${NC}           - Show differences from deployed stack"
        echo -e "  ${BLUE}deploy [stack]${NC} - Deploy stack(s) (default: all)"
        echo -e "  ${BLUE}bootstrap [region]${NC} - Bootstrap CDK (default region: us-east-1)"
        echo -e "  ${BLUE}destroy${NC}        - Destroy all stacks (DANGER!)"
        echo -e "  ${BLUE}list${NC}           - List all stacks"
        echo -e "  ${BLUE}test${NC}           - Run tests"
        echo -e "  ${BLUE}build${NC}          - Build TypeScript"
        echo -e "  ${BLUE}clean${NC}          - Clean build artifacts"
        echo -e "  ${BLUE}install${NC}        - Install npm dependencies"
        echo -e "  ${BLUE}help${NC}           - Show this help"
        echo ""
        echo -e "${YELLOW}Examples:${NC}"
        echo -e "  ./deploy.sh synth"
        echo -e "  ./deploy.sh deploy"
        echo -e "  ./deploy.sh deploy AwsMicroservicesStack"
        echo -e "  ./deploy.sh bootstrap us-east-1"
        echo ""
        echo -e "${YELLOW}Note:${NC} If you encounter WSL path issues, use GitHub Actions for deployment"
        echo -e "See: .github/CICD_SETUP.md"
        ;;
esac

echo ""

